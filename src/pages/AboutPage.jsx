export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
        About Mega Deals Canada
      </h1>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-gray-600">
        <p>
          Mega Deals Canada tracks Amazon.ca prices around the clock and surfaces the ones
          worth your attention — real discounts, all-time lows, and active coupons, checked
          against price history rather than a marketing department's idea of a "was" price.
        </p>

        <p>
          Every deal on this site is cross-checked against real price-history data before
          it's posted, so a claimed discount reflects an actual drop from what the item has
          sold for recently — not an inflated list price invented to make the sale price look
          better.
        </p>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Affiliate Disclosure
          </h2>
          <p className="mt-2">
            Mega Deals Canada is a participant in the Amazon Services LLC Associates
            Program, an affiliate advertising program designed to provide a means for sites
            to earn advertising fees by advertising and linking to Amazon.ca.
          </p>
          <p className="mt-2">
            As an Amazon Associate, Mega Deals Canada earns from qualifying purchases. This
            means that when you click a link on this site and buy something on Amazon.ca, we
            may earn a small commission — at no additional cost to you. This never affects
            which products we choose to feature or the price you pay.
          </p>
        </div>

        <p>
          Prices, availability, and star ratings shown on this site are accurate as of the
          time each deal was last verified, but Amazon prices can change at any time. Always
          check the current price and details on Amazon.ca before completing a purchase.
        </p>

        <p>
          Questions, feedback, or a deal you think we should feature? Reach out at{" "}
          <a
            href="mailto:hello@megadealscanada.ca"
            className="font-medium text-red-600 underline decoration-red-200 underline-offset-2 hover:text-red-700"
          >
            hello@megadealscanada.ca
          </a>
          .
        </p>
      </div>
    </main>
  );
}
