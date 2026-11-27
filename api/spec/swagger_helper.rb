require "rails_helper"

# rswag: request specs under spec/requests describe the /api endpoints, and
# `bin/rails rswag:specs:swaggerize` writes them to swagger/v1/openapi.yaml (committed; the web app
# generates its API types from it). Responses are validated against these schemas.
RSpec.configure do |config|
  config.openapi_root = Rails.root.join("swagger").to_s
  config.openapi_format = :yaml
  # Every documented response must match its schema exactly: no undocumented properties.
  config.openapi_strict_schema_validation = true

  config.openapi_specs = {
    "v1/openapi.yaml" => {
      openapi: "3.0.3",
      info: { title: "URL shortener API", version: "v1" },
      servers: [ { url: "/" } ],
      paths: {},
      components: {
        schemas: {
          Error: {
            type: :object,
            required: %w[error],
            properties: {
              error: {
                type: :object,
                required: %w[code message fields],
                properties: {
                  code: { type: :string, description: "Stable machine-readable code" },
                  message: { type: :string },
                  fields: {
                    type: :object,
                    nullable: true,
                    description: "Validation messages per request field",
                    additionalProperties: { type: :array, items: { type: :string } }
                  }
                }
              }
            }
          },
          Link: {
            type: :object,
            required: %w[code short_url destination_url],
            properties: {
              code: { type: :string, example: "aZ3kP9q" },
              short_url: { type: :string, format: :uri, example: "https://go.cellow.space/aZ3kP9q" },
              destination_url: { type: :string, format: :uri, example: "https://example.com/a/long/path" }
            }
          },
          LinkCreate: {
            type: :object,
            required: %w[link],
            properties: {
              link: {
                type: :object,
                required: %w[url],
                properties: {
                  url: { type: :string, maxLength: 2048, example: "https://example.com/a/long/path" },
                  alias: {
                    type: :string,
                    pattern: "^[A-Za-z0-9_-]{3,30}$",
                    description: "Optional custom code, case-insensitively unique and not reserved"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
end
