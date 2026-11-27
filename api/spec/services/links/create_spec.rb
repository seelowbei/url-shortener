require "rails_helper"

RSpec.describe Links::Create do
  it "saves an anonymous link under a generated code" do
    result = described_class.call(url: "  https://example.com/a  ")

    expect(result).to be_success
    link = result.value
    expect(link).to be_persisted
    expect(link).to have_attributes(destination_url: "https://example.com/a", user_id: nil, custom_alias: false)
    expect(link.code).to match(/\A[A-Za-z0-9]{7}\z/)
  end

  it "treats a blank alias as no alias" do
    result = described_class.call(url: "https://example.com", custom_alias: "")

    expect(result).to be_success
    expect(result.value.custom_alias).to be(false)
  end

  it "saves a custom alias" do
    result = described_class.call(url: "https://example.com", custom_alias: "my-docs")

    expect(result).to be_success
    expect(result.value).to have_attributes(code: "my-docs", custom_alias: true)
  end

  it "fails with :invalid for a bad URL" do
    result = described_class.call(url: "ftp://example.com")

    expect(result.error).to eq(:invalid)
    expect(result.value.errors).to include(:destination_url)
    expect(Link.count).to eq(0)
  end

  it "fails with :invalid for a reserved alias" do
    result = described_class.call(url: "https://example.com", custom_alias: "Admin")

    expect(result.error).to eq(:invalid)
    expect(result.value.errors.details[:code]).to include(error: :reserved)
  end

  it "fails with :alias_taken when the alias exists in any case" do
    Link.create!(code: "my-docs", destination_url: "https://example.org", deleted_at: Time.current)

    result = described_class.call(url: "https://example.com", custom_alias: "MY-DOCS")

    expect(result.error).to eq(:alias_taken)
    expect(result.value.errors.details[:code]).to include(error: :taken)
    expect(Link.count).to eq(1)
  end
end
