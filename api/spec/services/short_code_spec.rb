require "rails_helper"

RSpec.describe ShortCode do
  def new_link = Link.new(destination_url: "https://example.com")

  def existing_link(code) = Link.create!(code:, destination_url: "https://example.org")

  describe ".generate" do
    it "returns 7 base62 characters" do
      codes = Array.new(50) { described_class.generate }

      expect(codes).to all(match(/\A[A-Za-z0-9]{7}\z/))
      expect(codes.uniq.size).to eq(50)
    end

    it "skips reserved words" do
      allow(SecureRandom).to receive(:alphanumeric).with(7).and_return("support", "Abc1234")

      expect(described_class.generate).to eq("Abc1234")
    end
  end

  describe ".call" do
    it "saves the link under a generated code" do
      result = described_class.call(new_link)

      expect(result).to be_success
      expect(result.value).to be_persisted
      expect(result.value.code).to match(/\A[A-Za-z0-9]{7}\z/)
    end

    it "retries with a fresh code when the code is taken, ignoring case" do
      existing_link("taken01")
      allow(described_class).to receive(:generate).and_return("TAKEN01", "fresh01")

      result = described_class.call(new_link)

      expect(result).to be_success
      expect(result.value.reload.code).to eq("fresh01")
      expect(described_class).to have_received(:generate).twice
    end

    it "keeps an enclosing transaction usable after a collision" do
      existing_link("taken01")
      allow(described_class).to receive(:generate).and_return("taken01", "fresh01")

      Link.transaction do
        described_class.call(new_link)
        expect(Link.count).to eq(2)
      end
    end

    it "raises after 5 collisions" do
      existing_link("taken01")
      allow(described_class).to receive(:generate).and_return("taken01")

      expect { described_class.call(new_link) }.to raise_error(ShortCode::Exhausted)
      expect(described_class).to have_received(:generate).exactly(5).times
    end

    it "returns :invalid with the link when it fails validation" do
      link = Link.new(destination_url: "ftp://example.com")

      result = described_class.call(link)

      expect(result).to be_failure
      expect(result.error).to eq(:invalid)
      expect(result.value).to be(link)
      expect(link.errors).to include(:destination_url)
      expect(link).not_to be_persisted
    end
  end
end
