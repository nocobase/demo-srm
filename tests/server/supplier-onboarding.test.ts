import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
  },
});
const key = () => `${Date.now()}.${randomUUID()}`;
const body = (value: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': key(),
  },
  body: JSON.stringify(value),
});
const emptyPost = (operationKey = key()): RequestInit => ({
  method: 'POST',
  headers: { origin: 'http://localhost', 'Idempotency-Key': operationKey },
});
const dateFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('supplier admission enforces ownership, reviewer decisions, renewal and expiry flags', async ({
  testApp,
  connection,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const createUser = async (username: string, roles: string[] = []) => {
    const password = 'Supplier-test-123!';
    const result = await admin.fetch(
      '/users',
      body({
        name: username,
        username,
        email: `${username}@example.test`,
        password,
        roleScopes: { app: roles },
      }),
    );
    expect(result.status).toBe(201);
    return signIn(testApp, { username, password });
  };
  const owner = await createUser('supplierowner');
  const stranger = await createUser('supplierstranger');
  const viewer = await createUser('supplierviewer', [
    'supplier-directory-viewer',
  ]);
  expect((await request('/suppliers/me')).status).toBe(401);
  expect((await stranger.fetch('/suppliers/directory')).status).toBe(403);
  expect((await viewer.fetch('/suppliers/review')).status).toBe(403);
  expect((await stranger.fetch('/supplierSettings')).status).toBe(403);
  expect(
    (await stranger.fetch('/supplierSettings/process/executions')).status,
  ).toBe(403);
  expect((await admin.fetch('/supplierSettings/process')).status).toBe(200);
  const saved = await owner.fetch(
    '/suppliers/me',
    body(
      {
        name: 'Power Equipment Supplier',
        creditCode: '91310000TEST20261109',
        category: 'equipment',
        contactName: 'Contact',
        contactPhone: '123456789',
        contactEmail: 'contact@example.test',
        address: '',
        notes: '',
      },
      'PUT',
    ),
  );
  expect(saved.status).toBe(200);
  const supplierId = (await saved.json()).data.id as string;
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    400,
  );
  expect((await stranger.fetch(`/suppliers/${supplierId}`)).status).toBe(403);
  expect(
    (await stranger.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(403);

  const form = new FormData();
  form.append(
    'file',
    new File(['test-license'], 'license.txt', { type: 'text/plain' }),
  );
  const upload = await owner.fetch('/supplierFiles/uploadOne', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body: form,
  });
  expect(upload.status).toBe(201);
  const uploaded = (await upload.json()).data as {
    id?: string;
    record?: { id: string };
  };
  const fileId = uploaded.record?.id ?? uploaded.id;
  expect(fileId).toBeTruthy();
  const fileUrl = `http://localhost${testApp.publicBasePath}/uploads/supplierQualifications/${fileId}.txt`;
  expect((await testApp.fetch(new Request(fileUrl))).status).toBe(401);
  expect((await stranger.fetch(fileUrl)).status).toBe(403);
  const ownerDownload = await owner.fetch(fileUrl);
  expect(ownerDownload.status).toBe(200);
  expect(await ownerDownload.text()).toBe('test-license');
  expect((await admin.fetch(fileUrl)).status).toBe(200);
  const saveQualification = async (validUntil: string) =>
    owner.fetch(
      '/suppliers/me/qualifications',
      body(
        [
          {
            typeCode: 'business-license',
            certificateNumber: 'TEST-LICENSE',
            validUntil,
            fileId,
          },
        ],
        'PUT',
      ),
    );
  expect((await saveQualification('2030-99-99')).status).toBe(400);
  const farDate = dateFromNow(400);
  const soonDate = dateFromNow(10);
  expect((await saveQualification(farDate)).status).toBe(200);
  const submitKey = key();
  const submitRequest = emptyPost(submitKey);
  expect(
    (await owner.fetch('/suppliers/me/submit', submitRequest)).status,
  ).toBe(200);
  expect(
    (await owner.fetch('/suppliers/me/submit', submitRequest)).status,
  ).toBe(200);
  expect(
    await connection
      .repository('supplierReviewEvents')
      .count({ filter: { supplierId, action: 'submit' } }),
  ).toBe(1);
  const briefPath = `/suppliers/${supplierId}/reviewBrief`;
  expect((await request(briefPath)).status).toBe(401);
  expect((await owner.fetch(briefPath)).status).toBe(403);
  expect((await stranger.fetch(briefPath)).status).toBe(403);
  expect((await viewer.fetch(briefPath)).status).toBe(403);
  const initialBriefResponse = await admin.fetch(briefPath);
  expect(initialBriefResponse.status).toBe(200);
  const initialBrief = (await initialBriefResponse.json()).data;
  expect(initialBrief.findings[0].status).toBe('complete');
  expect(initialBrief.findings[0].evidence.snapshotId).toBe(
    initialBrief.snapshot.id,
  );
  expect(initialBrief.findings[0].contentVerified).toBe(false);
  expect(initialBrief.previousReturn).toBeNull();
  const noModel = await admin.fetch(
    `/suppliers/${supplierId}/aiReview`,
    body({ mode: 'risks' }),
  );
  expect(noModel.status).toBe(200);
  expect((await noModel.json()).data.available).toBe(false);
  expect(
    (
      await owner.fetch(
        `/suppliers/${supplierId}/aiReview`,
        body({ mode: 'draft' }),
      )
    ).status,
  ).toBe(403);
  const changedReviewer = await admin.fetch(
    '/supplierSettings',
    body(
      { reviewerId: stranger.user.id, warningDays: 30, revision: 1 },
      'PATCH',
    ),
  );
  expect(changedReviewer.status).toBe(200);
  expect(
    (await admin.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(403);
  expect(
    (
      await stranger.fetch(
        `/suppliers/${supplierId}/return`,
        body({ note: 'Please correct the document' }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await admin.fetch(
        '/supplierSettings',
        body(
          { reviewerId: admin.user.id, warningDays: 30, revision: 2 },
          'PATCH',
        ),
      )
    ).status,
  ).toBe(200);
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    200,
  );
  const secondBriefResponse = await admin.fetch(briefPath);
  expect(secondBriefResponse.status).toBe(200);
  const secondBrief = (await secondBriefResponse.json()).data;
  expect(secondBrief.previousReturn.note).toBe('Please correct the document');
  expect(secondBrief.previousReturn.id).toBeTruthy();
  expect(secondBrief.changes[0].outcome).toBe('uncertain');
  expect(
    (
      await admin.fetch(
        `/suppliers/${supplierId}/return`,
        body({ note: 'stale', expectedVersion: initialBrief.supplier.version }),
      )
    ).status,
  ).toBe(409);
  expect(
    (await admin.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(200);
  const directory = await admin.fetch('/suppliers/directory');
  expect(directory.status).toBe(200);
  expect(
    (await directory.json()).data.some(
      (row: { id: string }) => row.id === supplierId,
    ),
  ).toBe(true);
  expect((await viewer.fetch('/suppliers/directory')).status).toBe(200);
  expect((await stranger.fetch(fileUrl)).status).toBe(403);
  expect((await owner.fetch(fileUrl)).status).toBe(200);
  const viewerDetail = await viewer.fetch(`/suppliers/${supplierId}`);
  expect(viewerDetail.status).toBe(200);
  const viewerData = (await viewerDetail.json()).data;
  expect(viewerData.canReview).toBe(false);
  expect(viewerData.ownerId).toBeUndefined();
  expect(viewerData.events).toEqual([]);
  expect(viewerData.submissions).toEqual([]);
  expect(
    viewerData.qualifications.every(
      (row: { file: unknown }) => row.file === null,
    ),
  ).toBe(true);
  expect(
    (await viewer.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(403);
  expect((await saveQualification(soonDate)).status).toBe(200);
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    200,
  );
  expect((await admin.fetch('/suppliers/directory')).status).toBe(200);
  const renewalDetail = (
    await (await admin.fetch(`/suppliers/${supplierId}`)).json()
  ).data;
  expect(
    renewalDetail.qualifications.some(
      (row: { stage: string; validUntil: string }) =>
        row.stage === 'current' && row.validUntil === farDate,
    ),
  ).toBe(true);
  expect(
    renewalDetail.qualifications.some(
      (row: { stage: string; validUntil: string }) =>
        row.stage === 'proposed' && row.validUntil === soonDate,
    ),
  ).toBe(true);
  expect(
    renewalDetail.events.some(
      (row: { action: string; note?: string }) =>
        row.action === 'return' && row.note === 'Please correct the document',
    ),
  ).toBe(true);
  await connection.repository('supplierQualifications').updateMany({
    filter: { supplierId, stage: 'proposed' },
    values: { validUntil: '2020-01-01' },
  });
  expect(
    (await admin.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(400);
  await connection.repository('supplierQualifications').updateMany({
    filter: { supplierId, stage: 'proposed' },
    values: { validUntil: soonDate },
  });
  expect(
    (await admin.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(200);
  const expiring = await admin.fetch('/suppliers/expiring');
  expect(expiring.status).toBe(200);
  expect(
    (await expiring.json()).data.some(
      (row: { supplierId: string; expiryState: string }) =>
        row.supplierId === supplierId && row.expiryState === 'expiring',
    ),
  ).toBe(true);
  expect(
    (await (await admin.fetch('/suppliers/directory')).json()).data.find(
      (row: { id: string }) => row.id === supplierId,
    ).expiryState,
  ).toBe('expiring');
  await connection.repository('supplierQualifications').updateMany({
    filter: { supplierId, stage: 'current' },
    values: { validUntil: '2020-01-01' },
  });
  const expired = await admin.fetch('/suppliers/expiring');
  expect(
    (await expired.json()).data.some(
      (row: { supplierId: string; expiryState: string }) =>
        row.supplierId === supplierId && row.expiryState === 'expired',
    ),
  ).toBe(true);
  expect(
    (await (await admin.fetch('/suppliers/directory')).json()).data.find(
      (row: { id: string }) => row.id === supplierId,
    ).expiryState,
  ).toBe('expired');
  const now = new Date();
  for (let index = 0; index < 20; index++) {
    await connection.repository('suppliers').createOne({
      values: {
        id: randomUUID(),
        ownerId: `list-owner-${index}`,
        name: `A Supplier ${String(index).padStart(2, '0')}`,
        creditCode: `LIST-CREDIT-${index}`,
        category: 'equipment',
        contactName: 'Contact',
        contactPhone: '123456789',
        contactEmail: `list-${index}@example.test`,
        status: 'approved',
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  expect(
    (await (await admin.fetch('/suppliers/directory?page=1')).json()).data,
  ).toHaveLength(20);
  expect(
    (await (await admin.fetch('/suppliers/directory?page=2')).json()).data.map(
      (row: { id: string }) => row.id,
    ),
  ).toContain(supplierId);
});

test('category rules block incomplete submission and submitted rules remain frozen', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const password = 'Supplier-test-123!';
  const created = await admin.fetch(
    '/users',
    body({
      name: 'Rule applicant',
      username: 'ruleapplicant',
      email: 'rules@example.test',
      password,
      roleScopes: { app: [] },
    }),
  );
  expect(created.status).toBe(201);
  const owner = await signIn(testApp, { username: 'ruleapplicant', password });
  expect((await request('/supplierAdmissionRules')).status).toBe(401);
  expect(
    (await owner.fetch('/supplierAdmissionRules/service', body([], 'PUT')))
      .status,
  ).toBe(403);
  const profile = await owner.fetch(
    '/suppliers/me',
    body(
      {
        name: 'Rule Test Supplier',
        creditCode: '91310000RULETEST001',
        category: 'service',
        contactName: 'Contact',
        contactPhone: '123456789',
        contactEmail: 'rules@example.test',
      },
      'PUT',
    ),
  );
  expect(profile.status).toBe(200);
  const supplierId = (await profile.json()).data.id as string;
  const checklist = await owner.fetch(
    '/suppliers/me/checklist?category=service',
  );
  expect(checklist.status).toBe(200);
  expect((await checklist.json()).data[0].status).toBe('missing');
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    400,
  );
  const form = new FormData();
  form.append(
    'file',
    new File(['license'], 'license.txt', { type: 'text/plain' }),
  );
  const upload = await owner.fetch('/supplierFiles/uploadOne', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body: form,
  });
  expect(upload.status).toBe(201);
  const uploaded = (await upload.json()).data as {
    id?: string;
    record?: { id: string };
  };
  const fileId = uploaded.record?.id ?? uploaded.id;
  expect(fileId).toBeTruthy();
  expect(
    (
      await owner.fetch(
        '/suppliers/me/qualifications',
        body(
          [{ typeCode: 'business-license', fileId, validUntil: '2020-01-01' }],
          'PUT',
        ),
      )
    ).status,
  ).toBe(200);
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    400,
  );
  const noDate = [{ typeCode: 'business-license', fileId, validUntil: null }];
  expect(
    (await owner.fetch('/suppliers/me/qualifications', body(noDate, 'PUT')))
      .status,
  ).toBe(200);
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    400,
  );
  const changed = await admin.fetch(
    '/supplierAdmissionRules/service',
    body(
      [
        {
          typeCode: 'business-license',
          required: true,
          checkValidity: false,
          enabled: true,
        },
      ],
      'PUT',
    ),
  );
  expect(changed.status).toBe(200);
  const allRules = (await (await admin.fetch('/supplierAdmissionRules')).json())
    .data;
  expect(
    allRules.find(
      (rule: { category: string; typeCode: string }) =>
        rule.category === 'equipment' && rule.typeCode === 'business-license',
    ).checkValidity,
  ).toBe(true);
  const serviceRule = allRules.find(
    (rule: { category: string; typeCode: string }) =>
      rule.category === 'service' && rule.typeCode === 'business-license',
  );
  expect(
    (
      await admin.fetch(
        '/supplierAdmissionRules/service',
        body(
          [
            {
              typeCode: 'business-license',
              required: true,
              checkValidity: false,
              enabled: true,
            },
          ],
          'PUT',
        ),
      )
    ).status,
  ).toBe(200);
  const repeated = (await (await admin.fetch('/supplierAdmissionRules')).json())
    .data;
  expect(
    repeated.find(
      (rule: { category: string; typeCode: string }) =>
        rule.category === 'service' && rule.typeCode === 'business-license',
    ).id,
  ).toBe(serviceRule.id);
  expect(
    (await admin.fetch('/supplierAdmissionRules/service', body([], 'PUT')))
      .status,
  ).toBe(400);
  expect((await owner.fetch('/suppliers/me/submit', emptyPost())).status).toBe(
    200,
  );
  const submitted = (
    await (await admin.fetch(`/suppliers/${supplierId}`)).json()
  ).data;
  expect(submitted.submissions).toHaveLength(1);
  expect(submitted.submissions[0].requirements[0].checkValidity).toBe(false);
  expect(submitted.submissions[0].results[0].status).toBe('complete');
  expect(
    (
      await admin.fetch(
        '/supplierAdmissionRules/service',
        body(
          [
            {
              typeCode: 'business-license',
              required: true,
              checkValidity: true,
              enabled: true,
            },
          ],
          'PUT',
        ),
      )
    ).status,
  ).toBe(200);
  expect(
    (await admin.fetch(`/suppliers/${supplierId}/approve`, body({}))).status,
  ).toBe(200);
  const approved = (
    await (await admin.fetch(`/suppliers/${supplierId}`)).json()
  ).data;
  expect(approved.submissions[0].requirements[0].checkValidity).toBe(false);
  expect(approved.status).toBe('approved');
});

test('testing and inspection suppliers use their own category rules', async ({
  testApp,
  connection,
}) => {
  const rulesFor = (category: string) =>
    connection.query
      .selectFrom('supplierAdmissionRules')
      .selectAll()
      .where('category', '=', category)
      .execute();
  const seeded = await rulesFor('testing');
  expect(seeded).toHaveLength(1);
  expect(seeded[0]).toMatchObject({ typeCode: 'business-license' });
  expect(Boolean(seeded[0]!.required)).toBe(true);
  expect(Boolean(seeded[0]!.checkValidity)).toBe(true);
  const { default: seed } =
    await import('../../database/main/seeds/202611100001_supplier_testing_category.js');
  await seed.run({ query: connection.query } as never);
  await seed.run({ query: connection.query } as never);
  expect((await rulesFor('testing')).map((rule) => rule.id)).toEqual([
    seeded[0]!.id,
  ]);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const password = 'Supplier-test-123!';
  expect(
    (
      await admin.fetch(
        '/users',
        body({
          name: 'Testing applicant',
          username: 'testingapplicant',
          email: 'testing@example.test',
          password,
          roleScopes: { app: [] },
        }),
      )
    ).status,
  ).toBe(201);
  const owner = await signIn(testApp, {
    username: 'testingapplicant',
    password,
  });
  const created = await admin.fetch(
    '/supplierQualificationTypes',
    body({
      code: 'test-accreditation',
      name: 'Test accreditation',
      category: 'testing',
      required: true,
      enabled: true,
    }),
  );
  expect(created.status).toBeLessThan(300);
  const serviceBefore = await rulesFor('service');
  expect(
    (
      await admin.fetch(
        '/supplierAdmissionRules/testing',
        body(
          [
            {
              typeCode: 'business-license',
              required: true,
              checkValidity: false,
              enabled: true,
            },
            {
              typeCode: 'test-accreditation',
              required: true,
              checkValidity: true,
              enabled: true,
            },
          ],
          'PUT',
        ),
      )
    ).status,
  ).toBe(200);
  expect(await rulesFor('service')).toEqual(serviceBefore);

  const saveProfile = (category: string) =>
    owner.fetch(
      '/suppliers/me',
      body(
        {
          name: 'Testing Lab Supplier',
          creditCode: '91310000TESTINGLAB01',
          category,
          contactName: 'Contact',
          contactPhone: '123456789',
          contactEmail: 'testing@example.test',
        },
        'PUT',
      ),
    );
  const profile = await saveProfile('testing');
  expect(profile.status).toBe(200);
  const supplierId = (await profile.json()).data.id as string;
  const checklist = (
    await (await owner.fetch('/suppliers/me/checklist?category=testing')).json()
  ).data as { typeCode: string; checkValidity: boolean; status: string }[];
  expect(
    checklist
      .map(({ typeCode, checkValidity, status }) => ({
        typeCode,
        checkValidity,
        status,
      }))
      .sort((left, right) => left.typeCode.localeCompare(right.typeCode)),
  ).toEqual([
    { typeCode: 'business-license', checkValidity: false, status: 'missing' },
    { typeCode: 'test-accreditation', checkValidity: true, status: 'missing' },
  ]);
  const uploadFile = async (name: string) => {
    const form = new FormData();
    form.append(
      'file',
      new File([name], `${name}.txt`, { type: 'text/plain' }),
    );
    const upload = await owner.fetch('/supplierFiles/uploadOne', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: form,
    });
    expect(upload.status).toBe(201);
    const data = (await upload.json()).data as {
      id?: string;
      record?: { id: string };
    };
    return (data.record?.id ?? data.id)!;
  };
  const licenseId = await uploadFile('license');
  const accreditationId = await uploadFile('accreditation');
  const save = (accreditation?: { validUntil: string | null }) =>
    owner.fetch(
      '/suppliers/me/qualifications',
      body(
        [
          { typeCode: 'business-license', fileId: licenseId, validUntil: null },
          ...(accreditation
            ? [
                {
                  typeCode: 'test-accreditation',
                  fileId: accreditationId,
                  ...accreditation,
                },
              ]
            : []),
        ],
        'PUT',
      ),
    );
  const rejected = async (reason: string) => {
    const response = await owner.fetch('/suppliers/me/submit', emptyPost());
    expect(response.status).toBe(400);
    expect((await response.json()).error.reason).toBe(reason);
    const current = await connection
      .repository('suppliers')
      .findOne({ filter: { id: supplierId } });
    expect(current?.status).toBe('draft');
  };
  expect((await save()).status).toBe(200);
  await rejected('MISSING:test-accreditation');
  expect((await save({ validUntil: null })).status).toBe(200);
  await rejected('DATEMISSING:test-accreditation');
  expect((await save({ validUntil: dateFromNow(-1) })).status).toBe(200);
  await rejected('EXPIRED:test-accreditation');

  // Switching category re-evaluates against the new category's rules.
  expect((await save({ validUntil: dateFromNow(200) })).status).toBe(200);
  expect((await saveProfile('service')).status).toBe(200);
  await rejected('INVALID_QUALIFICATION_TYPE');
  expect((await saveProfile('testing')).status).toBe(200);

  const submitted = await owner.fetch('/suppliers/me/submit', emptyPost());
  expect(submitted.status).toBe(200);
  expect((await submitted.json()).data.status).toBe('pending');
  const snapshot = await connection
    .repository('supplierSubmissionSnapshots')
    .findOne({ filter: { supplierId } });
  expect(snapshot?.category).toBe('testing');
});
