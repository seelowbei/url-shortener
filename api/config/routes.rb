Rails.application.routes.draw do
  # Health: used by Kamal, the pipeline smoke tests and uptime monitoring.
  get "up", to: "health#show", as: :health_check

  namespace :api do
    get "health", to: "/health#show"
  end

  # Last: short codes, so they never shadow the routes above.
  constraints(code: /[A-Za-z0-9_-]{3,30}/) do
    get "/:code", to: "redirects#show", format: false
  end
end
