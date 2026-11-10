import { randomUUID } from 'node:crypto';
import { defineSeed } from '@nocobase/db';

/**
 * Gives the testing and inspection service category the baseline rule every category needs: a required business
 * license whose expiration date is checked. Category-specific certificates are configured by administrators.
 * An existing rule for the pair is left as the administrator saved it.
 */
export default defineSeed({
  name: '202611100001_supplier_testing_category',
  transaction: true,
  async run({ query }) {
    const type = await query
      .selectFrom('supplierQualificationTypes')
      .select('code')
      .where('code', '=', 'business-license')
      .executeTakeFirst();
    if (!type) throw new Error('Default qualification type is missing');
    const existing = await query
      .selectFrom('supplierAdmissionRules')
      .select('id')
      .where('category', '=', 'testing')
      .where('typeCode', '=', type.code)
      .executeTakeFirst();
    if (existing) return;
    const now = new Date();
    await query
      .insertInto('supplierAdmissionRules')
      .values({
        id: randomUUID(),
        category: 'testing',
        typeCode: type.code,
        required: true,
        checkValidity: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  },
});
