import fileUi from '../extensions/nocobase-file-component-ui/locales/en-US.js';
import type { LocaleResource } from '@nocobase/i18n';

import systemEnUS from './system/en-US.js';

const enUS = {
  // The template's own copy: the shell, the sign-in pages, shared components and the homepage. Keep it in
  // `./system/` so a template upgrade can replace it without touching the application's copy below.
  ...systemEnUS,
  ...fileUi,
  suppliers: {
    home: {
      title: 'Supplier management',
      description:
        'Register, review and maintain qualified electrical equipment and technical service suppliers.',
      open: 'Open',
    },
    loading: 'Loading…',
    loadFailed: 'Could not load supplier data.',
    saveFailed: 'Could not save. Review the fields and try again.',
    submitFailed:
      'Could not submit. Check that every required qualification has a valid file and expiration date.',
    saved: 'Saved.',
    submitted: 'Submitted for review.',
    search: 'Search supplier name or credit code',
    searchAction: 'Search',
    previous: 'Previous',
    next: 'Next',
    yes: 'Yes',
    no: 'No',
    remove: 'Remove',
    addQualification: 'Add qualification',
    saveProfile: 'Save profile',
    saveQualifications: 'Save qualifications',
    submit: 'Submit application',
    submitRenewal: 'Submit renewal',
    completeQualification:
      'Complete the qualification type, expiration date and file before saving.',
    history: 'Review history',
    checklist: {
      title: 'Required materials and missing items',
      submissionRules: 'Requirements and checks at submission',
      optional: 'Optional',
      complete: 'Complete',
      missing: 'File missing',
      expired: 'Certificate expired',
      dateMissing: 'Expiration date missing',
      notProvided: 'Not provided (optional)',
      legacyBaseline: 'Migration baseline; original rules unavailable',
      expirationRequired: 'Expiration date required and checked',
      noExpirationCheck: 'Expiration not checked',
      empty: 'No requirements are configured for this category.',
    },
    blocked: {
      title: 'Fix these items before submitting:',
      missing: '{{name}}: the required file has not been uploaded.',
      dateMissing: '{{name}}: enter the expiration date.',
      expired:
        '{{name}}: the certificate expired on {{date}}. Upload a valid one.',
      expiredUnknown:
        '{{name}}: the certificate has expired. Upload a valid one.',
      notApplicable:
        '{{name}}: not used for this category. Remove it and save the qualifications.',
      duplicate: '{{name}}: listed more than once. Keep one and save.',
      unsavedCategory:
        'Save the company profile to apply the new category before submitting.',
      unsavedQualifications: 'Save the qualifications before submitting.',
      checklistLoading:
        'Loading the requirements for this category. Submitting is available once they are checked.',
      checklistFailed:
        'The requirements for this category could not be loaded. Reload the page and try again.',
      noRequirements:
        'This category has no required qualifications configured. Contact the administrator.',
      notApplicableRow:
        'Not used for the selected category. Remove this qualification.',
    },
    my: {
      title: 'My supplier application',
      description:
        'Register your company and submit qualification documents for review.',
    },
    profile: { title: 'Company profile' },
    qualifications: {
      title: 'Qualifications',
      current: 'Approved qualifications',
      proposed: 'Documents for review',
      renewal: 'Replacement documents for renewal',
    },
    qualificationTypes: { businessLicense: 'Business license' },
    review: {
      title: 'Review queue',
      description: 'Review submitted supplier applications and renewals.',
      empty: 'No applications match this search.',
      decision: 'Review decision',
      note: 'Review note',
      approve: 'Approve',
      return: 'Return for changes',
      reasonRequired: 'Enter a reason before returning the application.',
      confirmReturn: 'Confirm return',
      confirmDescription:
        'The supplier will receive this review note after you confirm.',
      cancel: 'Cancel',
      confirm: 'Confirm return',
      stale: 'The application changed. Refresh and review it before deciding.',
    },
    ai: {
      title: 'AI review assistant',
      models: 'AI models',
      description:
        'Server checks use the rules saved with this submission. AI suggestions are advisory.',
      checkedAt: 'Checked at',
      expiring: 'Expiring soon',
      evidence: 'View evidence',
      snapshot: 'Submission snapshot',
      qualification: 'Qualification record',
      contentUnverified:
        'Document contents and authenticity have not been verified.',
      previousReturn: 'Last return and supplementation',
      returnEvent: 'Return event',
      noPreviousReturn: 'No previous return for this application.',
      unresolved: 'Still unresolved',
      supplemented: 'Material changed; confirm the issue is resolved',
      uncertain: 'Cannot confirm',
      materialChanged: 'Material or date changed',
      refresh: 'Refresh checks',
      analyze: 'Analyze risks',
      draft: 'Draft review note',
      generating: 'Generating suggestion…',
      unavailable:
        'AI is unavailable. The server checks above remain available.',
      suggestion: 'AI suggestion',
      advisory: 'Verify the evidence before making a decision.',
      loadFailed: 'Could not load the review checks.',
    },
    directory: {
      title: 'Qualified suppliers',
      description:
        'Approved suppliers remain listed even when a qualification expires.',
      empty: 'No qualified suppliers found.',
    },
    expiring: {
      title: 'Expiring qualifications',
      description:
        'Certificates due within the configured warning period, including expired certificates.',
      empty: 'No expiring qualifications.',
    },
    expiry: { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired' },
    detail: { title: 'Supplier details' },
    fields: {
      name: 'Company name',
      creditCode: 'Unified social credit code',
      category: 'Supplier category',
      contactName: 'Contact name',
      contactPhone: 'Phone',
      contactEmail: 'Email',
      address: 'Address',
      notes: 'Notes',
      status: 'Review status',
      updatedAt: 'Updated',
      type: 'Qualification type',
      certificateNumber: 'Certificate number',
      validUntil: 'Valid until',
      expiryState: 'Expiry state',
    },
    categories: {
      equipment: 'Electrical equipment',
      service: 'Technical services',
      both: 'Equipment and services',
      testing: 'Testing and inspection services',
    },
    status: {
      draft: 'Draft',
      pending: 'Awaiting review',
      returned: 'Returned for changes',
      approved: 'Approved',
      renewalPending: 'Renewal awaiting review',
      renewalReturned: 'Renewal returned for changes',
    },
    actions: {
      submit: 'Submitted',
      approve: 'Approved',
      return: 'Returned for changes',
    },
    processTransitions: {
      submit: 'Submit',
      return: 'Return',
      resubmit: 'Resubmit',
      approve: 'Approve',
      renew: 'Submit renewal',
      returnRenewal: 'Return renewal',
      resubmitRenewal: 'Resubmit renewal',
      approveRenewal: 'Approve renewal',
    },
    roles: { viewer: 'Qualified supplier directory viewer' },
    settings: {
      title: 'Supplier onboarding',
      description:
        'Manage the reviewer, certificate rules and expiry warning period.',
      policy: 'Review and expiry policy',
      reviewer: 'Designated reviewer',
      warningDays: 'Warning days before expiry',
      save: 'Save policy',
      types: 'Qualification requirements',
      required: 'Required',
      enabled: 'Enabled',
      checkValidity: 'Check expiration',
      addRule: 'Add requirement',
      chooseType: 'Choose qualification type',
      saveRules: 'Save category requirements',
      code: 'Code',
      name: 'Name',
      addType: 'Add type',
      allCategories: 'All categories',
      process: 'Approval process',
      processName: 'Supplier admission and renewal',
      definitions: 'Definition',
      executions: 'Execution history',
      noExecutions: 'No review activity yet.',
    },
  },
  // The application's copy goes here, one group per feature. A shared group such as `navigation` is extended by
  // spreading the system one first, `navigation: { ...systemEnUS.navigation, orders: 'Orders' }`, since a group
  // written here replaces the system group of the same name rather than merging with it.
};

/**
 * The shape every locale of this application follows, derived from the English wording above.
 *
 * Anything a plugin does not translate falls back to this namespace, so a term defined here is reused everywhere
 * without each plugin repeating it.
 */
export type AppResource = LocaleResource<typeof enUS>;

export default enUS;
