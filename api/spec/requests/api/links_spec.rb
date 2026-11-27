require "swagger_helper"

RSpec.describe "Links API", type: :request do
  path "/api/links" do
    post "Shorten a URL" do
      tags "Links"
      operationId "createLink"
      description "Anonymous for now. Rate limited to 10 creates a minute per client. " \
        "State-changing requests must send an allowed Origin header."
      consumes "application/json"
      produces "application/json"
      parameter name: :Origin, in: :header, required: false, schema: { type: :string },
        description: "Set by the browser; must be in ALLOWED_ORIGINS, or the request gets 403"
      parameter name: :body, in: :body, required: true, schema: { "$ref" => "#/components/schemas/LinkCreate" }

      let(:Origin) { "http://localhost:3001" }
      let(:body) { { link: { url: "https://example.com/a/long/path" } } }

      def error = response.parsed_body.fetch("error")

      response "201", "link created" do
        schema "$ref" => "#/components/schemas/Link"

        run_test! do
          link = Link.sole
          expect(response.parsed_body).to eq(
            "code" => link.code,
            "short_url" => "http://localhost:3000/#{link.code}",
            "destination_url" => "https://example.com/a/long/path"
          )
          expect(link.user_id).to be_nil
        end
      end

      response "422", "invalid URL or alias (validation_failed), or alias taken (alias_taken)" do
        schema "$ref" => "#/components/schemas/Error"
        let(:body) { { link: { url: "ftp://example.com", alias: "admin" } } }

        run_test! do
          expect(error["code"]).to eq("validation_failed")
          expect(error["fields"]).to eq(
            "url" => [ "must be an http or https URL with a host" ],
            "alias" => [ "is reserved" ]
          )
          expect(Link.count).to eq(0)
        end
      end

      response "400", "missing link parameter" do
        schema "$ref" => "#/components/schemas/Error"
        let(:body) { { url: "https://example.com" } }

        run_test! do
          expect(error).to eq(
            "code" => "bad_request", "message" => "Missing or invalid parameter: link", "fields" => nil
          )
        end
      end

      response "403", "Origin not allowed" do
        schema "$ref" => "#/components/schemas/Error"
        let(:Origin) { "https://evil.example" }

        run_test! do
          expect(error["code"]).to eq("invalid_origin")
          expect(Link.count).to eq(0)
        end
      end

      response "429", "rate limited" do
        schema "$ref" => "#/components/schemas/Error"

        # The test cache is a null store, so fake the counter going past the limit.
        before { allow(Rails.cache).to receive(:increment).and_return(11) }

        run_test! do
          expect(error["code"]).to eq("rate_limited")
          expect(Link.count).to eq(0)
        end
      end
    end
  end

  # Cases beyond the one example per status that the OpenAPI file documents.
  describe "POST /api/links" do
    let(:headers) { { "Origin" => "http://localhost:3001" } }

    def create_link(link) = post("/api/links", params: { link: }, headers:, as: :json)

    it "creates a link with a custom alias" do
      create_link(url: "https://example.com", alias: "my-docs")

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["code"]).to eq("my-docs")
      expect(Link.sole.custom_alias).to be(true)
    end

    it "returns 422 alias_taken when the alias exists in another case" do
      Link.create!(code: "My-Docs", destination_url: "https://example.org")

      create_link(url: "https://example.com", alias: "my-docs")

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to include(
        "code" => "alias_taken", "fields" => { "alias" => [ "is already taken" ] }
      )
    end

    it "returns 400 for a malformed JSON body" do
      post "/api/links", params: "{", headers: headers.merge("Content-Type" => "application/json")

      expect(response).to have_http_status(:bad_request)
      expect(response.parsed_body["error"]["message"]).to eq("Malformed request body")
    end
  end

  describe "rate limit" do
    let(:headers) { { "Origin" => "http://localhost:3001" } }
    let(:store) { ActiveSupport::Cache::MemoryStore.new }

    before { allow(Rails.cache).to receive(:increment) { |*args, **opts| store.increment(*args, **opts) } }

    it "allows 10 creates a minute per client, keyed by a hash of the IP" do
      11.times { post "/api/links", params: { link: { url: "https://example.com" } }, headers:, as: :json }

      expect(response).to have_http_status(:too_many_requests)
      expect(Link.count).to eq(10)
      expect(Rails.cache).to have_received(:increment)
        .with("rate-limit:api/links:#{Digest::SHA256.hexdigest('127.0.0.1')}", 1, expires_in: 1.minute)
        .exactly(11).times
    end
  end
end
