# GET /:code: the redirect hot path (docs/spec/backend.md#redirect-hot-path-redirectscontrollershow).
#
# Inherits ActionController::API directly: no session, no cookies, no auth. One indexed lookup,
# nothing written to the links row and no third-party call, so a redirect never waits on anyone.
class RedirectsController < ActionController::API
  include ActionView::Rendering # API controllers don't render templates by default (pages/not_found)

  def show
    link = Link.live.select(:id, :code, :destination_url, :disabled_at, :flagged_at).find_by(code: params[:code])
    return render_not_found if link.nil? || link.disabled_at?

    # Step 8: a flagged link renders pages/interstitial (200) here instead of redirecting.
    # Step 6: Visitor.from(request) bot check, then ClickJob.perform_later for humans.

    expires_in 0, public: false # Cache-Control: max-age=0, private
    redirect_to link.destination_url, status: :found, allow_other_host: true
  end

  private
    def render_not_found
      render template: "pages/not_found", formats: :html, content_type: "text/html", status: :not_found
    end
end
