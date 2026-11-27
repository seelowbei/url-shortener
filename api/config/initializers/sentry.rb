# Error tracking with Sentry (docs/spec/backend.md#observability).
#
# Off unless SENTRY_DSN is set: with no DSN the SDK sends nothing, so dev, test and a deploy
# whose environment lacks the secret all run without it. Errors from requests (sentry-rails'
# middleware) and Active Job (Solid Queue) are captured; performance tracing stays off to save
# free-plan quota. Events are sent from a background thread, so a request never waits on Sentry.
#
# No personal data leaves the app (AGENTS.md hard constraints): no IP, user, cookies, bodies,
# query strings or job arguments (ClickJob carries the visitor's IP and user agent), and only
# an allow-list of harmless request headers.
Sentry.init do |config|
  config.dsn = ENV["SENTRY_DSN"].presence
  # One image runs in staging and production: the release is the product version from
  # version.txt, and APP_ENV tells the two apart. The commit is a tag on every event.
  config.release = Rails.configuration.x.app_version
  config.environment = ENV.fetch("APP_ENV", Rails.env)
  config.traces_sample_rate = nil

  data = config.data_collection
  data.user_info = false
  data.cookies = false
  data.http_bodies = []
  data.url_query_params = false
  data.database_query_data = false
  data.queues = false
  data.graphql.document = false
  data.graphql.variables = false
  # Headers and the Rack env share this filter. Anything off the allow-list (REMOTE_ADDR,
  # X-Forwarded-For, User-Agent, Referer, …) is sent as "[Filtered]". Terms match
  # case-insensitive substrings.
  data.http_headers.request = Sentry::DataCollection::KeyValueCollection.new(
    mode: :allow_list,
    terms: %w[content- accept host origin x-request-id server_]
  )
  data.http_headers.response = Sentry::DataCollection::KeyValueCollection.new(
    mode: :allow_list,
    terms: %w[content- x-request-id]
  )

  git_sha = Rails.configuration.x.git_sha
  config.before_send = lambda do |event, _hint|
    event.tags = event.tags.merge(git_sha: git_sha)
    event
  end
end
