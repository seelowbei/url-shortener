# What every service's `.call` returns. `error` is a symbol (:invalid, :unsafe_url, …) on failure;
# `value` is the result on success, and may carry context on failure (e.g. the invalid record).
Result = Data.define(:value, :error) do
  def self.success(value = nil) = new(value:, error: nil)
  def self.failure(error, value = nil) = new(value:, error:)

  def success? = error.nil?
  def failure? = !success?
end
