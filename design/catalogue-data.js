/* catalogue-data.js — the seventeen products, grouped by act, lifted from index.html on 2026-08-20.
 *
 * THE COPY IS THE SITE'S, UNCHANGED. This file exists so the prototype argues about LAYOUT rather than about
 * wording: a box that looks right here has to hold the real sentence, not a shorter one written to fit it.
 *
 * `art` names the wireframe motif the cover is drawn with — one per domain, six in all, and every one of them a
 * PLACEHOLDER. The real box art is a later job; this is enough of a system to prove the component and no more.
 */
window.CATALOGUE = [
  {
    act: 'Act IV', says: 'Scale, then agents',
    items: [
      {
        id: 'qaai', name: 'QAAI', art: 'agentic',
        marks: ['Multi-agent', 'CI/CD', 'All platforms'],
        at: 'Yahoo!', role: 'Agentic Engineer', when: 'Sep 2025 – Jul 2026',
        fig: { n: 500, suffix: '+' },
        outcome: 'Tests generated, executed and self-healed from natural language, at a 95%+ pass rate in CI/CD.',
        did: 'App-, platform- and LLM-agnostic: one test case runs unchanged on iOS, Android and Web. Saves executives, project managers, QA and developers across every app team hundreds of hours weekly.'
      },
      {
        id: 'mail', name: 'Yahoo! Mail', art: 'consumer',
        marks: ['Android', 'Compose', 'A11y'],
        at: 'Yahoo!', role: 'Agentic Engineer', when: 'Sep 2025 – Jul 2026',
        outcome: 'Features built to EAA compliance, and the QA pain points taken out behind them.',
        did: 'Developed and maintained features on Yahoo! Mail alongside the agentic plugin work, with a focus on accessibility.'
      },
      {
        id: 'sc', name: 'Store Companion', art: 'agentic',
        marks: ['Android', 'Gen AI', 'Scanner'],
        at: 'Target', role: 'Lead Android Developer', when: 'Aug 2022 – Apr 2025',
        outcome: 'Generative AI answering store team members straight out of Target’s own documentation.',
        did: 'Created the chat experience for free-form questions — viewing responses, giving feedback on the AI’s answers, and scanning barcodes to enquire about items or guest orders.'
      },
      {
        id: 'myday', name: 'myDay', art: 'retail',
        marks: ['Android', 'Compose', 'Zebra'],
        at: 'Target', role: 'Lead Android Developer', when: 'Aug 2022 – Apr 2025',
        fig: { n: 100000, suffix: '+' },
        outcome: 'Daily active team members, completing in-store tasks, generating billions of calls a day.',
        did: 'Led the myDay team through updating and maintaining a multi-module monolith, mentoring on Compose and Kotlin and working with other teams on shared components and the backing APIs.'
      },
    ]
  },
  {
    act: 'Act III', says: 'Money and the store floor',
    items: [
      {
        id: 'self', name: 'Self Pickup', art: 'retail',
        marks: ['Web'],
        at: 'Kohl’s', role: 'Senior Android Developer', when: 'Jan 2021 – Aug 2022',
        outcome: 'Walk into the store, enter a code, collect the order, walk out.',
        did: 'Designed and developed a web app letting customers collect online orders with no staff involved. The customer gets an email when the order is ready.'
      },
      {
        id: 'pick', name: 'Pickup', art: 'retail',
        marks: ['Android', 'Offline', 'Zebra'],
        at: 'Kohl’s', role: 'Senior Android Developer', when: 'Jan 2021 – Aug 2022',
        outcome: 'In-store, drive-up and self-pickup orders, found by scan or by customer details — online or off.',
        did: 'A redesign of the associate-facing app to simplify adoption, increase productivity and add offline capability.'
      },
      {
        id: 'isu', name: 'ISU', art: 'retail',
        marks: ['Android', 'Core library'],
        at: 'Kohl’s', role: 'Senior Android Developer', when: 'Jan 2021 – Aug 2022',
        outcome: 'Inventory, stock and unload — plus the core library sitting under every associate app Kohl’s ships.',
        did: 'Focused on reducing tech debt and bringing the core library up to current practice, with automated testing added to the apps and their build pipeline.'
      },
      {
        id: 'oro', name: 'ORO Pay', art: 'fintech',
        marks: ['Android', 'Camera', 'GPS'],
        at: 'i2020 Fintech', role: 'Senior Android Developer', when: 'Aug 2019 – Sep 2020',
        outcome: 'Card accounts for the underbanked in Brazil — store money, send it and spend it with no bank account and no credit card.',
        did: 'An ORO Store for digital goods, Lot&eacute;rica and ATM transfers, and in-app phone top-ups — then a greenfield Kotlin rewrite with Cognito login and a new card carousel.'
      },
      {
        id: 'merch', name: 'ORO Merchant', art: 'fintech',
        marks: ['Android', 'QR', 'ML Kit'],
        at: 'i2020 Fintech', role: 'Senior Android Developer', when: 'Aug 2019 – Sep 2020',
        outcome: 'A QR renderer paired with Google ML Kit scanning, for peer-to-peer transfers at a merchant.',
        did: 'The merchant side of ORO, taking payments from ORO Pay and from card readers at Brazilian businesses.'
      },
    ]
  },
  {
    act: 'Act II', says: 'Into the field',
    items: [
      {
        id: 'fv', name: 'FieldView', art: 'field',
        marks: ['Android', 'iOS', 'Windows', 'Offline'],
        at: 'Viewpoint', role: 'Mobile Developer', when: 'Jul 2017 – Mar 2019',
        fig: { n: 10000, suffix: '+' },
        outcome: 'Active devices globally, on sites, in an app dating back to the Pocket PC days.',
        did: 'Construction personnel navigate a site in real time, file forms, complete task lists and track progress — so companies can record who completed what and compile a digital record of all activity.'
      },
      {
        id: 'team', name: 'Team', art: 'field',
        marks: ['Android', 'iOS', 'Windows'],
        at: 'Viewpoint', role: 'Mobile Developer', when: 'Jul 2017 – Mar 2019',
        outcome: 'Android, iOS and Windows shipping the same feature set in every monthly release.',
        did: 'Team lets users raise RFIs — requests for information — to get what they need to finish a job on site. Xamarin for Windows and iOS, native on Android.'
      },
      {
        id: 'tab', name: 'TabbedOut', art: 'consumer',
        marks: ['Android'],
        at: 'Rave', role: 'Android Developer', when: 'Mar 2017 – May 2017',
        outcome: 'The UI fixed across every screen size, and the crashes stopped.',
        did: 'A contract through a partnership between the two companies, maintaining and updating the app’s features.'
      },
      {
        id: 'house', name: 'Housekeeping', art: 'field',
        marks: ['Android', 'Offline', 'GPS'],
        at: 'Vacasa', role: 'Android Developer', when: 'Mar 2015 – Jan 2017',
        outcome: 'Cleaning details, hours worked, maintenance tickets, supplies, directions and the key house details.',
        did: 'An internal Android app for Vacasa’s housekeepers, with the data it runs on designed alongside the API team.'
      },
    ]
  },
  {
    act: 'Act I', says: 'Learning the hardware',
    items: [
      {
        id: 'rexel', name: 'Rexel USA', art: 'retail',
        marks: ['Android', 'iOS', 'Scanner'],
        at: 'Rexel', role: 'Mobile Application Developer', when: 'Jul 2014 – Feb 2015',
        outcome: 'All of Rexel’s brands and their languages out of a single Titanium build.',
        did: 'A mobile e-commerce app leaning on device hardware — a barcode scanner among it — to make buying on a phone worth doing.'
      },
      {
        id: '123', name: '123 Calling', art: 'consumer',
        marks: ['iOS', 'Localised'],
        at: 'Itsy Bitsy Stories', role: 'Mobile / Web Developer', when: 'May 2012 – Jul 2014',
        outcome: 'An iOS app converted to Simplified Chinese so Chinese students could use it to learn English.',
        did: 'The first mobile role, and the start of the fourteen years.'
      },
      {
        id: 'kiosk', name: 'Asian Art Museum Kiosk', art: 'consumer',
        marks: ['Android', 'Kiosk'],
        at: 'Itsy Bitsy Stories', role: 'Mobile / Web Developer', when: 'May 2012 – Jul 2014',
        outcome: 'A tablet in the gallery, letting visitors open up the work in front of them.',
        did: 'Ran on an Android tablet placed beside a piece at the San Francisco Asian Art Museum, letting visitors select and learn more about aspects of the work and zoom in on close-up detail.'
      },
      {
        id: 'ink', name: 'Ink Usage Dashboard', art: 'tooling',
        marks: ['Web', 'Graphs'],
        at: 'Hewlett-Packard', role: 'Software Engineer Intern', when: 'Jun 2012 – Aug 2012',
        outcome: 'Weekly graph production, cut from an afternoon to a coffee break.',
        did: 'An internal web page displaying and graphing printhead and ink usage, with a new heat-map graph for analysing usage trends.'
      },
    ]
  },
];
