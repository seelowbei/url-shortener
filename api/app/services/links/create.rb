# Creates an anonymous short link (accounts arrive with build step 4, the Safe Browsing check with
# step 8). The model normalizes and validates the URL and alias.
#
#   Links::Create.call(url: "https://example.com")                      # generated code
#   Links::Create.call(url: "https://example.com", custom_alias: "docs") # custom alias
#
# Returns Result.success(link), or Result.failure(error, link) with the reasons in link.errors:
# - :invalid      the URL or alias fails validation
# - :alias_taken  another link (live or deleted) already has that code
module Links
  class Create
    def self.call(...) = new.call(...)

    def call(url:, custom_alias: nil)
      link = Link.new(destination_url: url)
      return ShortCode.call(link) if custom_alias.blank?

      link.code = custom_alias
      link.custom_alias = true
      save_with_alias(link)
    end

    private
      # The unique index on links.code decides, case-insensitively, whether the alias is free.
      def save_with_alias(link)
        saved = Link.transaction(requires_new: true) { link.save }
        saved ? Result.success(link) : Result.failure(:invalid, link)
      rescue ActiveRecord::RecordNotUnique => e
        raise unless e.message.include?(ShortCode::CODE_INDEX)

        link.errors.add(:code, :taken, message: "is already taken")
        Result.failure(:alias_taken, link)
      end
  end
end
