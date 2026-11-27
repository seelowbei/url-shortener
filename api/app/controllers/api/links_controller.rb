class Api::LinksController < Api::BaseController
  # 10 creates a minute per client (docs/spec/product.md#shorten-a-url); 60 for signed-in users
  # comes with auth. The key is a hash of the IP, so no raw IP lands in the cache. The store is
  # Rails.cache: Solid Cache in production, shared by every process.
  rate_limit to: 10, within: 1.minute, only: :create, store: Rails.cache,
    by: -> { Digest::SHA256.hexdigest(request.remote_ip) }

  # POST /api/links
  def create
    attrs = params.expect(link: [ :url, :alias ])
    result = Links::Create.call(url: attrs[:url], custom_alias: attrs[:alias])

    if result.success?
      render json: LinkResource.new(result.value).serialize, status: :created
    else
      render_failure(result)
    end
  end
end
