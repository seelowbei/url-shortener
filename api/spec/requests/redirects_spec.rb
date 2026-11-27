require "rails_helper"

RSpec.describe "Redirects", type: :request do
  let!(:link) { Link.create!(code: "abc1234", destination_url: "https://example.com/page?q=1") }

  # Captures every SQL statement the request runs, to prove the hot path only reads.
  def sql_during
    statements = []
    callback = ->(*, payload) { statements << payload[:sql] unless payload[:name] == "SCHEMA" }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    statements
  end

  describe "GET /:code" do
    it "redirects to the destination with a private, uncached 302" do
      get "/abc1234"

      expect(response).to have_http_status(:found)
      expect(response.location).to eq("https://example.com/page?q=1")
      expect(response.headers["Cache-Control"]).to eq("max-age=0, private")
    end

    it "sets no cookie" do
      get "/abc1234"

      expect(response.headers["Set-Cookie"]).to be_nil
    end

    it "does one read and never writes" do
      statements = sql_during { get "/abc1234" }

      expect(statements.size).to eq(1)
      expect(statements.first).to match(/\ASELECT .* FROM "links"/)
      expect(link.reload.updated_at).to eq(link.updated_at)
    end

    it "matches the code case-insensitively" do
      get "/ABC1234"

      expect(response).to have_http_status(:found)
      expect(response.location).to eq("https://example.com/page?q=1")
    end

    shared_examples "a not found page" do
      it "renders the HTML 404 page" do
        get path

        expect(response).to have_http_status(:not_found)
        expect(response.media_type).to eq("text/html")
        expect(response.body).to include("Link not found")
        expect(response.headers["Set-Cookie"]).to be_nil
      end
    end

    context "when the code doesn't exist" do
      let(:path) { "/nope123" }

      it_behaves_like "a not found page"
    end

    context "when the link is deleted" do
      let(:path) { "/abc1234" }

      before { link.update!(deleted_at: Time.current) }

      it_behaves_like "a not found page"
    end

    context "when the link is disabled" do
      let(:path) { "/abc1234" }

      before { link.update!(disabled_at: Time.current) }

      it_behaves_like "a not found page"
    end
  end

  describe "routing", type: :routing do
    it "does not shadow /up or /api/health" do
      expect(get: "/up").to route_to("health#show")
      expect(get: "/api/health").to route_to("health#show")
    end

    it "routes valid codes to redirects#show" do
      expect(get: "/a_B-9").to route_to("redirects#show", code: "a_B-9")
    end

    it "does not route codes outside the format" do
      expect(get: "/ab").not_to be_routable
      expect(get: "/#{"a" * 31}").not_to be_routable
      expect(get: "/abc.json").not_to be_routable
      expect(get: "/abc/def").not_to be_routable
    end
  end
end
