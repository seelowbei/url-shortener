require "rails_helper"

RSpec.describe "Health", type: :request do
  %w[/up /api/health].each do |path|
    describe "GET #{path}" do
      it "returns ok with the running version and commit" do
        get path

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq(
          "status" => "ok",
          "version" => Rails.configuration.x.app_version,
          "sha" => Rails.configuration.x.git_sha
        )
      end

      it "returns 503 when the database is unreachable" do
        allow(ActiveRecord::Base).to receive(:connection).and_raise(ActiveRecord::ConnectionNotEstablished)

        get path

        expect(response).to have_http_status(:service_unavailable)
        expect(response.parsed_body["status"]).to eq("error")
      end
    end
  end
end
