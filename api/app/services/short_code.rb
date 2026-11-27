# Saves a new link under a random 7-character base62 code. The unique index on links.code is the
# source of truth: a collision raises RecordNotUnique, and we retry with a fresh code.
#
#   result = ShortCode.call(Link.new(destination_url: url))
#   result.success? # => true, result.value is the saved link
#   result.error    # => :invalid when the link fails validation (result.value.errors has the fields)
class ShortCode
  LENGTH = 7
  MAX_ATTEMPTS = 5
  CODE_INDEX = "index_links_on_code"

  # Raised when every attempt collided. At 62^7 codes this means something is broken, so it's a 500.
  class Exhausted < StandardError; end

  def self.call(link) = new.call(link)

  # SecureRandom.alphanumeric draws from A-Z, a-z, 0-9: base62.
  def self.generate
    loop do
      code = SecureRandom.alphanumeric(LENGTH)
      return code unless Link.reserved_code?(code)
    end
  end

  def call(link)
    MAX_ATTEMPTS.times do
      link.code = self.class.generate
      # A savepoint, so a collision doesn't abort a transaction the caller may have open.
      saved = Link.transaction(requires_new: true) { link.save }
      return saved ? Result.success(link) : Result.failure(:invalid, link)
    rescue ActiveRecord::RecordNotUnique => e
      raise unless e.message.include?(CODE_INDEX)
    end

    raise Exhausted, "no free short code after #{MAX_ATTEMPTS} attempts"
  end
end
