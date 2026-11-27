# Parent of every /api controller (docs/spec/backend.md#request-handling).
#
# - Errors: every failure renders { "error": { "code", "message", "fields" } } with a stable code.
# - CSRF: POST/PATCH/PUT/DELETE must carry an Origin in config.x.allowed_origins, or get 403.
#
# Authentication arrives with build step 4.
class Api::BaseController < ApplicationController
  STATE_CHANGING_METHODS = %w[POST PATCH PUT DELETE].freeze
  # Model attributes → the API's field names, so clients see the names they sent.
  API_FIELD_NAMES = { destination_url: :url, code: :alias }.freeze

  # rescue_from handlers are searched bottom-up, so the catch-all comes first.
  rescue_from StandardError, with: :render_internal_error
  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
  rescue_from ActiveRecord::RecordInvalid, with: ->(e) { render_invalid(e.record) }
  rescue_from ActionController::ParameterMissing, ActionDispatch::Http::Parameters::ParseError,
    with: :render_bad_request
  rescue_from ActionController::TooManyRequests, with: :render_rate_limited

  before_action :verify_origin, if: -> { request.method.in?(STATE_CHANGING_METHODS) }

  # Matches config.x.allowed_origins entries, where `*` stands for one DNS label.
  def self.allowed_origin?(origin, allowed = Rails.configuration.x.allowed_origins)
    return false if origin.blank?

    allowed.any? do |entry|
      pattern = Regexp.escape(entry).gsub("\\*", "[a-z0-9-]+")
      origin.match?(/\A#{pattern}\z/i)
    end
  end

  private
    def render_error(status, code, message, fields: nil)
      render json: { error: { code:, message:, fields: } }, status:
    end

    # A failed service Result whose value is the record carrying the errors.
    def render_failure(result)
      case result.error
      when :invalid then render_invalid(result.value)
      when :alias_taken then render_invalid(result.value, code: "alias_taken", message: "Alias is already taken")
      else raise ArgumentError, "unhandled Result error: #{result.error.inspect}"
      end
    end

    def render_invalid(record, code: "validation_failed", message: "Validation failed")
      fields = record.errors.group_by_attribute.to_h do |attribute, errors|
        [ API_FIELD_NAMES.fetch(attribute, attribute), errors.map(&:message) ]
      end
      render_error :unprocessable_content, code, message, fields:
    end

    def verify_origin
      return if self.class.allowed_origin?(request.origin)

      render_error :forbidden, "invalid_origin", "Origin not allowed"
    end

    def render_not_found
      render_error :not_found, "not_found", "Not found"
    end

    def render_bad_request(exception)
      message = if exception.is_a?(ActionController::ParameterMissing)
        "Missing or invalid parameter: #{exception.param}"
      else
        "Malformed request body"
      end
      render_error :bad_request, "bad_request", message
    end

    def render_rate_limited
      render_error :too_many_requests, "rate_limited", "Too many requests, try again in a minute"
    end

    # sentry-rails only sees exceptions that escape the app, so report rescued ones here.
    def render_internal_error(exception)
      Rails.logger.error("[api] #{exception.class}: #{exception.message}")
      Sentry.capture_exception(exception)
      render_error :internal_server_error, "internal_error", "Something went wrong"
    end
end
