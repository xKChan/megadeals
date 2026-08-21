const LAST_UPDATED = "August 21, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-xs text-gray-400">Last updated: {LAST_UPDATED}</p>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
        This is a general-purpose template, not legal advice, and hasn't been reviewed by a
        lawyer. Before relying on it for a live site, have it checked against Canada's
        privacy law (PIPEDA) and any other rules that apply to your business.
      </div>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-gray-600">
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Overview
          </h2>
          <p className="mt-2">
            This Privacy Policy describes how Mega Deals Canada ("we," "us," or "our")
            handles information when you visit megadealscanada.ca (the "Site"). By using the
            Site, you agree to the practices described here.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Information We Collect
          </h2>
          <p className="mt-2">
            The Site does not require an account and does not ask you to submit personal
            information to browse deals. Like most websites, we may automatically collect
            limited technical information when you visit — such as your browser type,
            device type, approximate location, pages viewed, and the time and duration of
            your visit — typically through standard web server logs and/or an analytics
            tool.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">Cookies</h2>
          <p className="mt-2">
            The Site may use cookies or similar local-storage technology to remember basic
            preferences (for example, items you've bookmarked) and to understand how
            visitors use the Site. You can disable cookies in your browser settings, though
            some features may not work as intended if you do.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            How We Use Information
          </h2>
          <p className="mt-2">
            Any information collected is used to operate and improve the Site — for example,
            to understand which deals or categories are popular, diagnose technical issues,
            and measure affiliate link performance. We do not sell personal information.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Third-Party Links &amp; Affiliate Disclosure
          </h2>
          <p className="mt-2">
            The Site contains affiliate links to Amazon.ca. Mega Deals Canada is a
            participant in the Amazon Services LLC Associates Program, an affiliate
            advertising program designed to provide a means for sites to earn advertising
            fees by advertising and linking to Amazon.ca. When you click one of these links
            and make a purchase, we may earn a commission at no additional cost to you.
            Amazon's own privacy practices govern any information you provide once you leave
            this Site — see{" "}
            <a
              href="https://www.amazon.ca/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-red-600 underline decoration-red-200 underline-offset-2 hover:text-red-700"
            >
              Amazon's Privacy Notice
            </a>{" "}
            for details.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Data Security
          </h2>
          <p className="mt-2">
            We take reasonable measures to protect any information the Site handles, but no
            method of transmission or storage is 100% secure, and we can't guarantee
            absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Children's Privacy
          </h2>
          <p className="mt-2">
            The Site is not directed at children under 13, and we do not knowingly collect
            personal information from children.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Changes to This Policy
          </h2>
          <p className="mt-2">
            We may update this Privacy Policy from time to time. Changes will be posted on
            this page with an updated "Last updated" date.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-900">
            Contact Us
          </h2>
          <p className="mt-2">
            Questions about this Privacy Policy? Reach out at{" "}
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
