import { clientFileRepositoryManagerToken } from '@nocobase/app-plugin-file/client';
import {
  answerApi,
  renderWithApp,
  type ApiCall,
} from '@nocobase/app-testing/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import MySupplierPage from '../../client/pages/suppliers/my.js';
import enUS from '../../client/locales/en-US.js';
import packageMetadata from '../../package.json' with { type: 'json' };

it('loads the requirement checklist for the selected supplier category', async () => {
  const api = vi.fn(({ path }: ApiCall) => {
    if (path === 'suppliers/me')
      return {
        data: {
          supplier: null,
          reviewer: false,
          types: [
            {
              code: 'business-license',
              name: 'Business license',
              category: 'all',
              required: true,
              enabled: true,
            },
          ],
          rules: [
            {
              category: 'equipment',
              typeCode: 'business-license',
              name: 'Business license',
              required: true,
              checkValidity: true,
              enabled: true,
            },
          ],
        },
      };
    if (path === 'suppliers/me/checklist')
      return {
        data: [
          {
            typeCode: 'business-license',
            name: 'Business license',
            required: true,
            checkValidity: true,
            fileId: null,
            validUntil: null,
            status: 'missing',
          },
        ],
      };
    return new Response(null, { status: 404 });
  });
  await renderWithApp(
    <Routes>
      <Route path='/supplier-application' element={<MySupplierPage />} />
    </Routes>,
    {
      route: '/supplier-application',
      namespace: packageMetadata.name,
      namespaces: { [packageMetadata.name]: enUS },
      fetch: answerApi(api),
      services: (app) =>
        app.container.instance(clientFileRepositoryManagerToken, {
          repository: () => ({}),
        } as never),
    },
  );
  expect(
    await screen.findByText(enUS.suppliers.checklist.title),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'suppliers/me/checklist',
        query: { category: 'equipment' },
      }),
    ),
  );
  expect(
    await screen.findByText(enUS.suppliers.checklist.missing),
  ).toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText(enUS.suppliers.fields.category),
    'service',
  );
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'suppliers/me/checklist',
      query: { category: 'service' },
    }),
  );
});

const testingRules = [
  {
    category: 'testing',
    typeCode: 'business-license',
    name: 'Business license',
    required: true,
    checkValidity: true,
    enabled: true,
  },
  {
    category: 'testing',
    typeCode: 'test-accreditation',
    name: 'Test accreditation',
    required: true,
    checkValidity: true,
    enabled: true,
  },
];
const file = (id: string) => ({
  id,
  filename: `${id}.pdf`,
  ext: '.pdf',
  mimeType: 'application/pdf',
  size: 10,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  contentUrl: `/uploads/${id}.pdf`,
});
const qualification = (
  id: string,
  typeCode: string,
  validUntil: string | null,
) => ({
  id,
  typeCode,
  certificateNumber: '',
  validUntil,
  fileId: `${id}-file`,
  stage: 'proposed',
  file: file(`${id}-file`),
});
const renderTestingApplication = async (
  qualifications: ReturnType<typeof qualification>[],
  submit: () => Response | object = () => new Response(null, { status: 404 }),
) => {
  const api = vi.fn(({ path }: ApiCall) => {
    if (path === 'suppliers/me')
      return {
        data: {
          supplier: {
            id: '6c8bd2a2-5f43-4e3f-9b55-0d9f6a6a1b01',
            version: 1,
            ownerId: 'owner',
            name: 'Testing Lab',
            creditCode: '91310000TESTINGLAB01',
            category: 'testing',
            contactName: 'Contact',
            contactPhone: '123456789',
            contactEmail: 'lab@example.test',
            status: 'draft',
            updatedAt: '2026-11-01T00:00:00.000Z',
            qualifications,
            events: [],
            submissions: [],
          },
          reviewer: false,
          types: testingRules.map(({ typeCode, name }) => ({
            code: typeCode,
            name,
            category: 'all',
            required: true,
            enabled: true,
          })),
          rules: testingRules,
        },
      };
    if (path === 'suppliers/me/checklist')
      return {
        data: testingRules.map((rule) => ({
          ...rule,
          fileId: null,
          validUntil: null,
          status: 'missing',
        })),
      };
    if (path === 'suppliers/me/submit') return submit();
    return new Response(null, { status: 404 });
  });
  await renderWithApp(
    <Routes>
      <Route path='/supplier-application' element={<MySupplierPage />} />
    </Routes>,
    {
      route: '/supplier-application',
      namespace: packageMetadata.name,
      namespaces: { [packageMetadata.name]: enUS },
      fetch: answerApi(api),
      services: (app) =>
        app.container.instance(clientFileRepositoryManagerToken, {
          repository: () => ({}),
        } as never),
    },
  );
  expect(await screen.findByDisplayValue('Testing Lab')).toBeInTheDocument();
  return api;
};
const submitButton = () =>
  screen.getByRole('button', { name: enUS.suppliers.submit });

it('lists every reason that blocks a testing supplier from submitting', async () => {
  await renderTestingApplication([
    qualification('license', 'business-license', null),
    qualification('accreditation', 'test-accreditation', '2020-01-01'),
  ]);
  expect(
    await screen.findByText(enUS.suppliers.blocked.title),
  ).toBeInTheDocument();
  expect(
    await screen.findByText('Business license: enter the expiration date.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Test accreditation: the certificate expired on 2020-01-01. Upload a valid one.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(
      `${enUS.suppliers.settings.required} · ${enUS.suppliers.checklist.expirationRequired}`,
      { exact: false },
    ),
  ).toHaveLength(2);
  expect(submitButton()).toBeDisabled();
});

it('reports a missing required file and re-checks after switching category', async () => {
  await renderTestingApplication([
    qualification('license', 'business-license', '2099-01-01'),
  ]);
  expect(
    await screen.findByText(
      'Test accreditation: the required file has not been uploaded.',
    ),
  ).toBeInTheDocument();
  expect(submitButton()).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByLabelText(enUS.suppliers.fields.category),
    'service',
  );
  expect(
    await screen.findByText(enUS.suppliers.blocked.unsavedCategory),
  ).toBeInTheDocument();
  expect(submitButton()).toBeDisabled();
});

it('enables submit when materials are complete and explains a server rejection', async () => {
  const api = await renderTestingApplication(
    [
      qualification('license', 'business-license', '2099-01-01'),
      qualification('accreditation', 'test-accreditation', '2099-01-01'),
    ],
    () =>
      new Response(
        JSON.stringify({
          error: {
            status: 'FAILED_PRECONDITION',
            code: 400,
            domain: 'suppliers',
            reason: 'EXPIRED:test-accreditation',
            message: 'EXPIRED:test-accreditation',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
  );
  await waitFor(() => expect(submitButton()).toBeEnabled());
  expect(
    screen.queryByText(enUS.suppliers.blocked.title),
  ).not.toBeInTheDocument();
  await userEvent.click(submitButton());
  expect(
    await screen.findByText(
      'Test accreditation: the certificate has expired. Upload a valid one.',
    ),
  ).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'suppliers/me/submit' }),
  );
});
