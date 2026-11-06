// The hire-purchase assessment: one definition used by the API (validation), the storefront (the form) and the admin (the review screen).
// See planning/RETAIL_HP_SEPARATION.md.

export const GHANA_REGIONS = Object.freeze([
  'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North',
]);

const option = (value, label) => ({ value, label });

export const ASSESSMENT_SECTIONS = Object.freeze([
  {
    id: 'identity',
    title: 'Identity',
    intro: 'As printed on your Ghana Card.',
    fields: [
      { key: 'fullName', label: 'Full name on your Ghana Card', type: 'text', wide: true, autoComplete: 'name' },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date', autoComplete: 'bday' },
      { key: 'gender', label: 'Sex on your card', type: 'select', options: [option('female', 'Female'), option('male', 'Male')] },
      { key: 'ghanaCardPin', label: 'Ghana Card number', type: 'pin', wide: true, placeholder: 'GHA-123456789-0' },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    intro: 'We use these to reach you about your application.',
    fields: [
      { key: 'phone', label: 'Mobile number', type: 'phone', placeholder: '024 123 4567', autoComplete: 'tel' },
      { key: 'momoNumber', label: 'Mobile money number', type: 'phone', placeholder: '024 123 4567', hint: 'The number you would pay instalments from.' },
    ],
  },
  {
    id: 'residence',
    title: 'Where you live',
    intro: 'Your home address, not your workplace.',
    fields: [
      { key: 'digitalAddress', label: 'GhanaPostGPS address', type: 'digitalAddress', placeholder: 'GA-183-8164' },
      { key: 'region', label: 'Region', type: 'select', options: GHANA_REGIONS.map(region => option(region, region)) },
      { key: 'town', label: 'Town or city', type: 'text' },
      { key: 'area', label: 'Area or suburb', type: 'text' },
      { key: 'landmark', label: 'Nearest landmark', type: 'text', wide: true, max: 200, optional: true },
      {
        key: 'residentialStatus',
        label: 'You live in',
        type: 'select',
        options: [option('own_home', 'Your own home'), option('renting', 'A rented home'), option('family_home', 'A family home'), option('employer_housing', 'Housing from your employer')],
      },
      {
        key: 'timeAtAddress',
        label: 'How long you have lived there',
        type: 'select',
        options: [option('under_1_year', 'Under a year'), option('1_to_3_years', '1 to 3 years'), option('3_to_5_years', '3 to 5 years'), option('over_5_years', 'Over 5 years')],
      },
    ],
  },
  {
    id: 'employment',
    title: 'Work and income',
    intro: 'Your main source of income.',
    fields: [
      {
        key: 'employmentType',
        label: 'How you earn',
        type: 'select',
        wide: true,
        options: [option('public_salaried', 'Salaried, public sector'), option('private_salaried', 'Salaried, private company'), option('self_employed', 'Self-employed'), option('business_owner', 'Business owner'), option('other', 'Something else')],
      },
      { key: 'employer', label: 'Employer or business name', type: 'text' },
      { key: 'workLocation', label: 'Where you work', type: 'text' },
      { key: 'jobTitle', label: 'Job title or what you do', type: 'text' },
      { key: 'startDate', label: 'Started there in', type: 'month', placeholder: '2021-03' },
      { key: 'monthlyIncomeMinor', label: 'Monthly income after tax', type: 'money' },
      { key: 'payday', label: 'Day of the month you are paid', type: 'dayOfMonth', optional: true },
      { key: 'cagdStaffId', label: 'CAGD staff ID', type: 'text', max: 40, optional: true, hint: 'Public sector staff paid through the Controller and Accountant-General only.', showWhen: { key: 'employmentType', equals: 'public_salaried' } },
    ],
  },
  {
    id: 'commitments',
    title: 'Existing commitments',
    intro: 'Other loans or hire purchase you are paying now.',
    fields: [
      { key: 'hasExistingCredit', label: 'Are you paying any loans or hire purchase now?', type: 'select', wide: true, options: [option('yes', 'Yes'), option('no', 'No')] },
      { key: 'monthlyCommitmentsMinor', label: 'Total you pay each month', type: 'money', showWhen: { key: 'hasExistingCredit', equals: 'yes' } },
      { key: 'commitmentDetails', label: 'Who you pay', type: 'text', max: 300, placeholder: 'e.g. bank loan, phone on credit', showWhen: { key: 'hasExistingCredit', equals: 'yes' } },
    ],
  },
  {
    id: 'guarantor',
    title: 'Guarantor',
    intro: 'Someone who can vouch for you. Let them know first, because we may contact them.',
    fields: [
      { key: 'name', label: 'Their full name', type: 'text' },
      { key: 'ghanaCardPin', label: 'Their Ghana Card number', type: 'pin', placeholder: 'GHA-123456789-0' },
      { key: 'phone', label: 'Their mobile number', type: 'phone', placeholder: '024 123 4567' },
      { key: 'relationship', label: 'How you know them', type: 'text', placeholder: 'e.g. sibling, colleague' },
      { key: 'occupation', label: 'Their occupation', type: 'text', wide: true },
    ],
  },
]);

/** A field counts only when it applies to the answers given. Answers to fields that no longer apply are dropped on save. */
export const fieldApplies = (field, values) => !field.showWhen || values?.[field.showWhen.key] === field.showWhen.equals;

// Files uploaded with an application. Photos may be anything a phone camera produces; income evidence may also be a PDF.
export const ASSESSMENT_DOCUMENTS = Object.freeze([
  { id: 'ghana_card_front', label: 'Ghana Card, front', hint: 'All four corners in the photo, with the writing sharp.' },
  { id: 'ghana_card_back', label: 'Ghana Card, back', hint: 'All four corners in the photo, with the writing sharp.' },
  { id: 'selfie', label: 'A selfie', hint: 'Your face clearly, in good light, with no sunglasses or hat.', capture: 'user' },
  { id: 'income_1', label: 'Payslip or statement', hint: 'Your latest payslip, or a recent bank or mobile money statement if self-employed.', pdf: true },
  { id: 'income_2', label: 'Another payslip or statement', pdf: true, optional: true },
  { id: 'income_3', label: 'One more payslip or statement', pdf: true, optional: true },
]);

// What an assessor confirms by hand. Nothing is decided automatically.
export const ASSESSMENT_CHECKS = Object.freeze([
  { id: 'identity_confirmed', label: 'Ghana Card details confirmed' },
  { id: 'address_confirmed', label: 'Home address confirmed' },
  { id: 'employment_confirmed', label: 'Work confirmed with employer or business records' },
  { id: 'income_reviewed', label: 'Income evidence reviewed' },
  { id: 'commitments_reviewed', label: 'Existing commitments reviewed' },
  { id: 'guarantor_contacted', label: 'Guarantor contacted' },
]);

/** Everything a customer pays under a plan. Only the deposit and any delivery fee are due up front. */
export function hirePurchaseFigures({ cashPriceMinor, plan, deliveryFeeMinor = 0 }) {
  const depositMinor = Math.round(cashPriceMinor * plan.depositBasisPoints / 10_000);
  const balanceMinor = cashPriceMinor - depositMinor;
  const chargeMinor = Math.round(balanceMinor * plan.chargeBasisPoints / 10_000);
  const financedMinor = balanceMinor + chargeMinor;
  const instalment = Math.floor(financedMinor / plan.instalments);
  // Whole pesewas only, so any remainder goes on the final instalment.
  const instalments = Array.from({ length: plan.instalments }, (_, index) => ({
    number: index + 1,
    amountMinor: index === plan.instalments - 1 ? financedMinor - instalment * (plan.instalments - 1) : instalment,
  }));
  return {
    cashPriceMinor, depositMinor, balanceMinor, chargeMinor, financedMinor, hirePurchasePriceMinor: cashPriceMinor + chargeMinor, deliveryFeeMinor, dueNowMinor: depositMinor + deliveryFeeMinor, instalments,
  };
}

// What the applicant may do from each status. Staff moves are in backend/src/routes/admin-applications.js.
export const APPLICATION_EDITABLE = Object.freeze(['draft', 'needs_information']);
export const APPLICATION_WITHDRAWABLE = Object.freeze(['draft', 'submitted', 'under_review', 'needs_information']);
