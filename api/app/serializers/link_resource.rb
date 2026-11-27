# A link as the API returns it. Keep in line with the Link schema in spec/swagger_helper.rb.
class LinkResource
  include Alba::Resource

  attributes :code, :destination_url

  attribute :short_url do |link|
    "#{Rails.configuration.x.short_url_base}/#{link.code}"
  end
end
