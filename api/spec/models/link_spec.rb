require "rails_helper"

RSpec.describe Link do
  def build_link(**attrs)
    described_class.new(code: "abc1234", destination_url: "https://example.com/page", **attrs)
  end

  it "is valid with a code and an https URL" do
    expect(build_link).to be_valid
  end

  it "has the column defaults from the data model" do
    link = described_class.create!(code: "abc1234", destination_url: "https://example.com")

    expect(link).to have_attributes(
      user_id: nil, custom_alias: false, clicks_count: 0, stats_public: true,
      scan_status: "pending", disabled_at: nil, deleted_at: nil
    )
    expect(link).to be_scan_pending
  end

  describe "code" do
    it "strips surrounding whitespace" do
      expect(build_link(code: "  my-link ").code).to eq("my-link")
    end

    it "accepts letters, digits, underscores and hyphens, 3 to 30 characters" do
      %w[abc A_b-9 abcdefghijklmnopqrstuvwxyz0123].each do |code|
        expect(build_link(code:)).to be_valid, "expected #{code.inspect} to be valid"
      end
    end

    it "rejects codes that are too short, too long or have other characters" do
      [ "ab", "a" * 31, "has space", "dot.dot", "slash/", "ünï", "" ].each do |code|
        expect(build_link(code:)).not_to be_valid, "expected #{code.inspect} to be invalid"
      end
    end

    it "rejects reserved words, ignoring case" do
      link = build_link(code: "Dashboard")

      expect(link).not_to be_valid
      expect(link.errors.details[:code]).to include(error: :reserved)
    end

    it "reserves every top-level route" do
      %w[api up jobs].each { |code| expect(described_class.reserved_code?(code)).to be(true) }
    end

    it "is unique regardless of case, also against deleted links" do
      described_class.create!(code: "MyLink", destination_url: "https://example.com", deleted_at: Time.current)

      expect { described_class.create!(code: "mylink", destination_url: "https://example.org") }
        .to raise_error(ActiveRecord::RecordNotUnique)
    end
  end

  describe "destination_url" do
    it "accepts http and https URLs" do
      %w[http://example.com https://sub.example.com/path?q=1#frag].each do |url|
        expect(build_link(destination_url: url)).to be_valid, "expected #{url.inspect} to be valid"
      end
    end

    it "strips surrounding whitespace" do
      expect(build_link(destination_url: " https://example.com ").destination_url).to eq("https://example.com")
    end

    it "rejects other schemes, missing hosts and unparseable URLs" do
      [ "", "ftp://example.com", "javascript:alert(1)", "mailto:a@example.com", "example.com",
        "https://", "http:/example.com", "https://exa mple.com" ].each do |url|
        expect(build_link(destination_url: url)).not_to be_valid, "expected #{url.inspect} to be invalid"
      end
    end

    it "rejects URLs longer than 2048 characters" do
      url = "https://example.com/#{"a" * 2029}"
      expect(url.length).to eq(2049)

      expect(build_link(destination_url: url)).not_to be_valid
      expect(build_link(destination_url: url.chop)).to be_valid
    end

    it "rejects URLs on the short host, so links can't loop" do
      host = Rails.configuration.x.short_host

      [ "https://#{host}/abc1234", "http://#{host.upcase}:8080/x", "https://#{host}./abc" ].each do |url|
        link = build_link(destination_url: url)
        expect(link).not_to be_valid, "expected #{url.inspect} to be invalid"
        expect(link.errors.details[:destination_url]).to include(error: :short_host)
      end
    end
  end

  describe ".live" do
    it "excludes soft-deleted links" do
      live = described_class.create!(code: "live1", destination_url: "https://example.com")
      described_class.create!(code: "gone1", destination_url: "https://example.com", deleted_at: Time.current)

      expect(described_class.live).to contain_exactly(live)
    end
  end
end
