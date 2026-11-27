Rails.application.routes.draw do
  # Health: used by Kamal, the pipeline smoke tests and uptime monitoring.
  get "up", to: "health#show", as: :health_check

  namespace :api do
    get "health", to: "/health#show"
    resources :links, param: :code, only: :create
  end
end
