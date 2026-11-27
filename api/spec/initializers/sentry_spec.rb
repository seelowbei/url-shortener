require "rails_helper"
require "sentry/test_helper"

# config/initializers/sentry.rb: release/environment tagging, error capture from jobs, and
# that no personal data (IP, user agent, referrer, cookies, bodies, query strings, job
# arguments) is attached to events.
RSpec.describe "Sentry configuration" do
  include Sentry::TestHelper

  before { setup_sentry_test }
  after { teardown_sentry_test }

  def capture_with_request(env)
    Sentry.with_scope do |scope|
      scope.set_rack_env(env)
      Sentry.capture_exception(RuntimeError.new("boom"))
    end
    last_sentry_event
  end

  it "tags events with the release, environment and commit" do
    Sentry.capture_exception(RuntimeError.new("boom"))

    event = last_sentry_event
    expect(event.release).to eq(Rails.configuration.x.app_version)
    expect(event.environment).to eq(ENV.fetch("APP_ENV", Rails.env))
    expect(event.tags).to include(git_sha: Rails.configuration.x.git_sha)
  end

  it "has tracing off" do
    expect(Sentry.configuration.tracing_enabled?).to be(false)
  end

  it "sends the request path but no personal data" do
    env = Rack::MockRequest.env_for(
      "https://go.cellow.space/api/links?url=https://example.com/private",
      method: "POST",
      input: { url: "https://example.com/private" }.to_json,
      "CONTENT_TYPE" => "application/json",
      "REMOTE_ADDR" => "203.0.113.7",
      "HTTP_X_FORWARDED_FOR" => "203.0.113.7",
      "HTTP_USER_AGENT" => "Mozilla/5.0 (Test)",
      "HTTP_REFERER" => "https://example.com/from",
      "HTTP_COOKIE" => "session_id=abc",
      "HTTP_ACCEPT" => "application/json"
    )

    request = capture_with_request(env).to_h[:request]

    expect(request[:url]).to eq("https://go.cellow.space/api/links")
    expect(request[:query_string]).to be_nil
    expect(request[:data]).to be_nil
    expect(request[:cookies]).to be_blank
    expect(request[:headers]).to include("Accept" => "application/json", "Content-Type" => "application/json")
    # Headers outside the allow-list keep their name but lose their value.
    expect(request[:headers].values_at("User-Agent", "Referer", "X-Forwarded-For", "Cookie")).to all(eq("[Filtered]"))
    expect(request[:env]["REMOTE_ADDR"]).to eq("[Filtered]")
    expect(request.to_s).not_to include("203.0.113.7", "Mozilla", "example.com")
  end

  it "sends no user" do
    Sentry.capture_exception(RuntimeError.new("boom"))

    expect(last_sentry_event.to_h[:user]).to be_blank
  end

  describe "jobs" do
    let(:job_class) do
      Class.new(ApplicationJob) do
        def self.name = "SentryFailingJob"

        def perform(ip:, user_agent:)
          raise "job failed"
        end
      end
    end

    it "captures errors without the job arguments" do
      expect {
        job_class.perform_now(ip: "203.0.113.7", user_agent: "Mozilla/5.0 (Test)")
      }.to raise_error(RuntimeError, "job failed")

      event = last_sentry_event
      expect(event).to be_present
      # The stack trace is left out: its source context lines quote this spec's own literals.
      expect(event.to_h.except(:exception).to_s).not_to include("203.0.113.7", "Mozilla/5.0 (Test)")
    end
  end
end
