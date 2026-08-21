const LAST_UPDATED = "August 21, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-xs text-gray-400">Last updated: {LAST_UPDATED}</p>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
        This is a general-purpose template, not legal advice, and hasn't been reviewed by a
        lawyer. Before relying on it for a live site, have it checked by one — especially the
        liability and governing-law sections below, which need to reflect your actual
        business details.
      </div>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-gray-600">
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            1. Acceptance of Terms
          </h2>
          <p className="mt-2">
            By accessing or using megadealscanada.ca (the "Site"), you agree to be bound by
            these Terms of Service. If you do not agree, please do not use the Site.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            2. Description of Service
          </h2>
          <p className="mt-2">
            Mega Deals Canada curates and displays product deals available on Amazon.ca,
            including pricing, discount, and coupon information sourced from third-party
            price-tracking data. The Site is provided for informational purposes to help you
            discover deals — it is not a retailer, and all purchases are completed on
            Amazon.ca, subject to Amazon's own terms and conditions.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            3. Affiliate Disclosure
          </h2>
          <p className="mt-2">
            Mega Deals Canada is a participant in the Amazon Services LLC Associates
            Program, an affiliate advertising program designed to provide a means for sites
            to earn advertising fees by advertising and linking to Amazon.ca. As an Amazon
            Associate, Mega Deals Canada earns from qualifying purchases made through links
            on this Site, at no additional cost to you.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            4. Accuracy of Information
          </h2>
          <p className="mt-2">
            We make reasonable efforts to display accurate pricing and availability, and
            each deal is checked against price-history data before it's posted. However,
            prices, discounts, coupons, and stock levels on Amazon.ca can change at any time
            without notice, and we cannot guarantee that a price shown on this Site will
            still be available when you click through. Always confirm the current price and
            details on Amazon.ca before completing a purchase.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            5. Intellectual Property
          </h2>
          <p className="mt-2">
            The Site's design, layout, and original written content are the property of
            Mega Deals Canada. Product names, images, logos, and trademarks referenced on
            the Site belong to their respective owners and are used for identification
            purposes only.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            6. External Links
          </h2>
          <p className="mt-2">
            The Site links to Amazon.ca and other third-party sites. We are not responsible
            for the content, accuracy, or practices of external sites, including Amazon.ca
            itself.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            7. Limitation of Liability
          </h2>
          <p className="mt-2">
            The Site is provided "as is" without warranties of any kind. To the fullest
            extent permitted by law, Mega Deals Canada is not liable for any loss or damage
            arising from your use of the Site or reliance on information shown here,
            including pricing errors or expired deals beyond our control.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            8. Changes to These Terms
          </h2>
          <p className="mt-2">
            We may update these Terms from time to time. Changes will be posted on this page
            with an updated "Last updated" date. Continued use of the Site after changes are
            posted means you accept the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            9. Governing Law
          </h2>
          <p className="mt-2">
            These Terms are governed by the laws of Canada and the province in which Mega
            Deals Canada operates, without regard to conflict-of-law principles.{" "}
            <span className="italic">[Replace with your specific province before publishing.]</span>
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            10. Contact Us
          </h2>
          <p className="mt-2">
            Questions about these Terms? Reach out at{" "}
            <a
              href="mailto:hello@megadealscanada.ca"
              className="font-medium text-red-600 underline decoration-red-200 underline-offset-2 hover:text-red-700"
            >
              hello@megadealscanada.ca
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
