require "rails_helper"

RSpec.describe Api::BaseController, type: :controller do
  controller(described_class) do
    def index = render(json: { ok: true })
    def create = render(json: { ok: true }, status: :created)
    def show = raise(ActiveRecord::RecordNotFound)
    def update = Link.create!(code: "x", destination_url: "ftp://example.com")
    def destroy = raise("boom")
  end

  before { request.headers["Origin"] = "http://localhost:3001" }

  def error = response.parsed_body.fetch("error")

  describe "Origin check" do
    it "lets GET through without an Origin" do
      request.headers["Origin"] = nil
      get :index

      expect(response).to have_http_status(:ok)
    end

    it "lets a POST from an allowed origin through" do
      post :create

      expect(response).to have_http_status(:created)
    end

    it "rejects a POST from another origin with 403" do
      request.headers["Origin"] = "https://evil.example"
      post :create

      expect(response).to have_http_status(:forbidden)
      expect(error).to eq("code" => "invalid_origin", "message" => "Origin not allowed", "fields" => nil)
    end

    it "rejects a POST without an Origin" do
      request.headers["Origin"] = nil
      post :create

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe ".allowed_origin?" do
    let(:allowed) { [ "https://console.cellow.space", "https://web-*-team.vercel.app" ] }

    it "matches exact entries" do
      expect(described_class.allowed_origin?("https://console.cellow.space", allowed)).to be(true)
      expect(described_class.allowed_origin?("https://console.cellow.space.evil.example", allowed)).to be(false)
      expect(described_class.allowed_origin?("http://console.cellow.space", allowed)).to be(false)
    end

    it "lets * match one DNS label only" do
      expect(described_class.allowed_origin?("https://web-abc123-team.vercel.app", allowed)).to be(true)
      expect(described_class.allowed_origin?("https://web-a.b-team.vercel.app", allowed)).to be(false)
      expect(described_class.allowed_origin?("https://webXteam.vercel.app", allowed)).to be(false)
    end

    it "rejects a blank origin" do
      expect(described_class.allowed_origin?(nil, allowed)).to be(false)
    end
  end

  describe "error mapping" do
    it "maps RecordNotFound to 404" do
      get :show, params: { id: "1" }

      expect(response).to have_http_status(:not_found)
      expect(error["code"]).to eq("not_found")
    end

    it "maps RecordInvalid to 422 with fields under the API's names" do
      patch :update, params: { id: "1" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(error["code"]).to eq("validation_failed")
      expect(error["fields"].keys).to contain_exactly("url", "alias")
    end

    it "maps unexpected errors to a generic 500 and reports them to Sentry" do
      allow(Sentry).to receive(:capture_exception)
      delete :destroy, params: { id: "1" }

      expect(response).to have_http_status(:internal_server_error)
      expect(error).to eq("code" => "internal_error", "message" => "Something went wrong", "fields" => nil)
      expect(Sentry).to have_received(:capture_exception).with(an_instance_of(RuntimeError))
    end
  end
end
