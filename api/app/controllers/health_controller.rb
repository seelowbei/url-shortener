# GET /up and GET /api/health
#
# Used by Kamal's deploy health check, the pipeline smoke tests and UptimeRobot.
# Returns 200 with the running version when the app and its database are reachable,
# 503 otherwise, so a deploy with a broken database connection never goes live.
class HealthController < ApplicationController
  def show
    ActiveRecord::Base.connection.select_value("SELECT 1")
    render json: payload(status: "ok")
  rescue StandardError => e
    Rails.logger.error("[health] #{e.class}: #{e.message}")
    render json: payload(status: "error"), status: :service_unavailable
  end

  private

  def payload(status:)
    {
      status: status,
      version: Rails.configuration.x.app_version,
      sha: Rails.configuration.x.git_sha
    }
  end
end
