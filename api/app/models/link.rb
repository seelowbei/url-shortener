# A short link: `code` (generated or a custom alias) redirects to `destination_url`.
# `user_id` is null for anonymous links; the `user` association comes with auth (build step 4).
class Link < ApplicationRecord
  CODE_FORMAT = /\A[A-Za-z0-9_-]{3,30}\z/
  URL_MAX_LENGTH = 2048

  # Codes that would shadow a top-level route (docs/spec/backend.md#routes) or a product page.
  # Lowercase: codes are compared case-insensitively, like the citext column.
  RESERVED_CODES = %w[
    about account admin api app assets auth dashboard docs health help jobs links login logout
    me new public register settings signin signout signup static stats status support up www
  ].to_set.freeze

  enum :scan_status, { pending: "pending", clean: "clean", flagged: "flagged" }, prefix: :scan

  normalizes :code, with: ->(code) { code.strip }
  normalizes :destination_url, with: ->(url) { url.strip }

  validates :code, presence: true, format: { with: CODE_FORMAT, allow_blank: true }
  validate :code_not_reserved
  validates :destination_url, presence: true, length: { maximum: URL_MAX_LENGTH }
  validate :destination_url_is_web_url

  scope :live, -> { where(deleted_at: nil) }

  def self.reserved_code?(code)
    RESERVED_CODES.include?(code.to_s.downcase)
  end

  private
    def code_not_reserved
      errors.add(:code, :reserved, message: "is reserved") if self.class.reserved_code?(code)
    end

    def destination_url_is_web_url
      return if destination_url.blank? || destination_url.length > URL_MAX_LENGTH

      uri = URI.parse(destination_url)
      if !uri.is_a?(URI::HTTP) || uri.host.blank?
        errors.add(:destination_url, :invalid, message: "must be an http or https URL with a host")
      elsif uri.host.downcase.delete_suffix(".") == Rails.configuration.x.short_host.downcase
        errors.add(:destination_url, :short_host, message: "can't point to the short link domain")
      end
    rescue URI::InvalidURIError
      errors.add(:destination_url, :invalid, message: "must be an http or https URL with a host")
    end
end
