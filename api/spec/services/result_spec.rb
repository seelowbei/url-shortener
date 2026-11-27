require "rails_helper"

RSpec.describe Result do
  it "is a success with a value and no error" do
    result = described_class.success(:value)

    expect(result).to be_success
    expect(result).not_to be_failure
    expect(result.value).to eq(:value)
  end

  it "is a failure with an error, optionally carrying a value" do
    result = described_class.failure(:invalid, :record)

    expect(result).to be_failure
    expect(result).not_to be_success
    expect(result).to have_attributes(error: :invalid, value: :record)
  end
end
