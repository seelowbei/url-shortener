# Release version and commit of the running build.
# Both are passed into the Docker image as build args (see Dockerfile) and
# fall back to "dev" / "unknown" when running locally.
Rails.application.config.x.app_version = ENV.fetch("APP_VERSION", "dev")
Rails.application.config.x.git_sha = ENV.fetch("GIT_SHA", "unknown")
