import {
  ApiClientError,
  createUuid,
  useApiClient,
  useService,
  useSubmission,
} from '@nocobase/app-client';
import {
  clientFileRepositoryManagerToken,
  type FileRecord,
} from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import {
  FileUploadField,
  FileList,
} from '#extensions/nocobase-file-component-ui/index';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { useListData } from '#hooks/use-list-data';
import {
  supplierCategories,
  type SupplierCategory,
  type SupplierMyResponse,
  type SupplierResponse,
  type SupplierFile,
  type QualificationType,
  type AdmissionResult,
  type Qualification,
} from './model.js';

const initial: {
  name: string;
  creditCode: string;
  category: SupplierCategory;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  notes: string;
} = {
  name: '',
  creditCode: '',
  category: 'equipment',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  address: '',
  notes: '',
};
type Draft = {
  clientId: string;
  typeCode: string;
  certificateNumber: string;
  validUntil: string;
  file: SupplierFile | null;
};
/** The saved fields of a qualification row, used to detect edits that have not been saved yet. */
const qualificationKey = (rows: readonly Draft[]) =>
  JSON.stringify(
    rows
      .filter((row) => row.file)
      .map((row) => [
        row.typeCode,
        row.certificateNumber,
        row.validUntil,
        row.file?.id,
      ]),
  );
const toDraft = (q: Qualification): Draft => ({
  clientId: q.id,
  typeCode: q.typeCode,
  certificateNumber: q.certificateNumber ?? '',
  validUntil: q.validUntil ?? '',
  file: q.file,
});
/** Submit rejections whose reason is `<STATUS>:<typeCode>`, mapped to their checklist status. */
const rejectedStatuses: Record<string, 'missing' | 'dateMissing' | 'expired'> =
  { MISSING: 'missing', DATEMISSING: 'dateMissing', EXPIRED: 'expired' };
const emptyDraft = (): Draft => ({
  clientId: createUuid(),
  typeCode: 'business-license',
  certificateNumber: '',
  validUntil: '',
  file: null,
});

export default function MySupplierPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const manager = useService(clientFileRepositoryManagerToken);
  const files = useMemo(() => manager.repository('supplierFiles'), [manager]);
  const request = useListData<SupplierMyResponse>('suppliers/me');
  const supplier = request.data?.data.supplier;
  const reviewer = request.data?.data.reviewer;
  const types = request.data?.data.types ?? [];
  const rules = request.data?.data.rules ?? [];
  const [profile, setProfile] = useState<typeof initial>(initial);
  const checklist = useListData<{ data: AdmissionResult[] }>(
    `suppliers/me/checklist?category=${profile.category}`,
  );
  const [drafts, setDrafts] = useState<Draft[]>(() => [emptyDraft()]);
  const [message, setMessage] = useState('');
  const [busyUpload, setBusyUpload] = useState(false);
  const profileSubmission = useSubmission({ scope: 'supplier:profile' });
  const qualificationSubmission = useSubmission({
    scope: 'supplier:qualifications',
  });
  const submitSubmission = useSubmission({ scope: 'supplier:submit' });
  useEffect(() => {
    if (!supplier) return;
    const updatedProfile = {
      name: supplier.name,
      creditCode: supplier.creditCode,
      category: supplier.category,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      contactEmail: supplier.contactEmail,
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    };
    const proposed = supplier.qualifications.filter(
      (q) => q.stage === 'proposed',
    );
    const updatedDrafts = proposed.length
      ? proposed.map(toDraft)
      : [emptyDraft()];
    queueMicrotask(() => {
      setProfile(updatedProfile);
      setDrafts(updatedDrafts);
    });
  }, [supplier]);
  const editable = !supplier || ['draft', 'returned'].includes(supplier.status);
  const canRenew =
    supplier && ['approved', 'renewalReturned'].includes(supplier.status);
  const canEditQualifications = editable || canRenew;
  const setField = (key: keyof typeof initial, value: string) =>
    setProfile((old) => ({ ...old, [key]: value }));
  const itemName = (code: string, fallback?: string) =>
    code === 'business-license'
      ? t('suppliers.qualificationTypes.businessLicense')
      : (types.find((type) => type.code === code)?.name ?? fallback ?? code);
  const typeName = (code: string) => itemName(code);
  const applicableRules = rules.filter(
    (rule) => rule.enabled && rule.category === profile.category,
  );
  const applicableTypes = types.filter((type) =>
    applicableRules.some((rule) => rule.typeCode === type.code),
  );
  const visibleChecklist = checklist.data?.data.map((item) => {
    if (!canEditQualifications || supplier?.category !== profile.category)
      return item;
    const draft = drafts.find(
      (row) => row.typeCode === item.typeCode && row.file,
    );
    if (!draft)
      return {
        ...item,
        status: item.required ? ('missing' as const) : ('notProvided' as const),
      };
    if (item.checkValidity && !draft.validUntil)
      return { ...item, status: 'dateMissing' as const };
    if (
      item.checkValidity &&
      draft.validUntil < new Date().toISOString().slice(0, 10)
    )
      return { ...item, status: 'expired' as const };
    return { ...item, status: 'complete' as const };
  });
  const savedQualifications = useMemo(
    () =>
      qualificationKey(
        supplier?.qualifications
          .filter((q) => q.stage === 'proposed')
          .map(toDraft) ?? [],
      ),
    [supplier],
  );
  const notApplicable = (row: Draft) =>
    Boolean(row.file) &&
    !applicableRules.some((rule) => rule.typeCode === row.typeCode);
  // Mirrors the server's submit check on the materials shown here, so the applicant sees every reason at once.
  // The submit route stays authoritative and its rejection is explained below as well.
  const blockers: string[] = [];
  if (canEditQualifications && supplier && checklist.data) {
    if (supplier.category !== profile.category)
      blockers.push(t('suppliers.blocked.unsavedCategory'));
    for (const item of visibleChecklist ?? []) {
      const name = itemName(item.typeCode, item.name);
      if (item.status === 'missing')
        blockers.push(t('suppliers.blocked.missing', { name }));
      else if (item.status === 'dateMissing')
        blockers.push(t('suppliers.blocked.dateMissing', { name }));
      else if (item.status === 'expired') {
        const date = drafts.find(
          (row) => row.typeCode === item.typeCode && row.file,
        )?.validUntil;
        blockers.push(
          t('suppliers.blocked.expired', { name, date: date ?? '' }),
        );
      }
    }
    const seen = new Set<string>();
    for (const row of drafts.filter((draft) => draft.file)) {
      if (notApplicable(row))
        blockers.push(
          t('suppliers.blocked.notApplicable', {
            name: typeName(row.typeCode),
          }),
        );
      else if (seen.has(row.typeCode))
        blockers.push(
          t('suppliers.blocked.duplicate', { name: typeName(row.typeCode) }),
        );
      seen.add(row.typeCode);
    }
    if (!(visibleChecklist ?? []).some((item) => item.required))
      blockers.push(t('suppliers.blocked.noRequirements'));
    if (!blockers.length && qualificationKey(drafts) !== savedQualifications)
      blockers.push(t('suppliers.blocked.unsavedQualifications'));
  }
  const rejection = (error: unknown) => {
    const reason = error instanceof ApiClientError ? (error.reason ?? '') : '';
    const [code = '', typeCode = ''] = reason.split(':');
    const name = typeName(typeCode);
    const status = rejectedStatuses[code];
    if (status === 'expired')
      return t('suppliers.blocked.expiredUnknown', { name });
    if (status) return t(`suppliers.blocked.${status}`, { name });
    if (reason === 'INVALID_QUALIFICATION_TYPE')
      return t('suppliers.blocked.notApplicable', {
        name: t('suppliers.qualifications.title'),
      });
    if (reason === 'DUPLICATE_QUALIFICATION_TYPE')
      return t('suppliers.blocked.duplicate', {
        name: t('suppliers.qualifications.title'),
      });
    if (reason === 'NO_REQUIRED_QUALIFICATIONS')
      return t('suppliers.blocked.noRequirements');
    return t('suppliers.submitFailed');
  };
  const saveProfile = async () => {
    setMessage('');
    try {
      await profileSubmission.run(profile, async (key, signal, value) =>
        api.request<SupplierResponse>({
          path: 'suppliers/me',
          method: 'PUT',
          json: value,
          headers: { 'Idempotency-Key': key },
          signal,
        }),
      );
      request.reload();
      checklist.reload();
      setMessage(t('suppliers.saved'));
    } catch {
      setMessage(t('suppliers.saveFailed'));
    }
  };
  const saveQualifications = async () => {
    setMessage('');
    const values = drafts
      .filter((row) => row.typeCode || row.file)
      .map((row) => ({
        typeCode: row.typeCode,
        certificateNumber: row.certificateNumber,
        validUntil: row.validUntil || null,
        fileId: row.file?.id ?? '',
      }));
    if (
      values.some(
        (row) =>
          !row.typeCode ||
          !row.fileId ||
          (applicableRules.find((rule) => rule.typeCode === row.typeCode)
            ?.checkValidity &&
            !row.validUntil),
      )
    ) {
      setMessage(t('suppliers.completeQualification'));
      return;
    }
    try {
      await qualificationSubmission.run(values, async (key, signal, value) =>
        api.request<SupplierResponse>({
          path: 'suppliers/me/qualifications',
          method: 'PUT',
          json: value,
          headers: { 'Idempotency-Key': key },
          signal,
        }),
      );
      request.reload();
      checklist.reload();
      setMessage(t('suppliers.saved'));
    } catch {
      setMessage(t('suppliers.saveFailed'));
    }
  };
  const submit = async () => {
    setMessage('');
    try {
      await submitSubmission.run(
        { supplierId: supplier?.id },
        async (key, signal) =>
          api.request<SupplierResponse>({
            path: 'suppliers/me/submit',
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            signal,
          }),
      );
      request.reload();
      setMessage(t('suppliers.submitted'));
    } catch (error) {
      checklist.reload();
      setMessage(rejection(error));
    }
  };
  return (
    <PageContainer className='mx-auto max-w-5xl space-y-6'>
      <PageHeader
        title={t('suppliers.my.title')}
        description={t('suppliers.my.description')}
        actions={
          reviewer ? (
            <Link to='/supplier-review'>
              <Button variant='outline'>{t('suppliers.review.title')}</Button>
            </Link>
          ) : undefined
        }
      />
      {request.loading ? (
        <p>{t('suppliers.loading')}</p>
      ) : request.error ? (
        <p role='alert'>{t('suppliers.loadFailed')}</p>
      ) : (
        <>
          {supplier && (
            <p className='rounded-md border border-border bg-card p-3 text-sm'>
              {t(`suppliers.status.${supplier.status}`)}
              {supplier.reviewNote ? ` · ${supplier.reviewNote}` : ''}
            </p>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('suppliers.profile.title')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                {(
                  [
                    'name',
                    'creditCode',
                    'contactName',
                    'contactPhone',
                    'contactEmail',
                    'address',
                  ] as const
                ).map((key) => (
                  <label key={key} className='space-y-1 text-sm'>
                    <span>{t(`suppliers.fields.${key}`)}</span>
                    <Input
                      value={profile[key]}
                      disabled={!editable}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  </label>
                ))}
                <label className='space-y-1 text-sm'>
                  <span>{t('suppliers.fields.category')}</span>
                  <select
                    className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                    disabled={!editable}
                    value={profile.category}
                    onChange={(e) => setField('category', e.target.value)}
                  >
                    {supplierCategories.map((value) => (
                      <option key={value} value={value}>
                        {t(`suppliers.categories.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className='block space-y-1 text-sm'>
                <span>{t('suppliers.fields.notes')}</span>
                <Textarea
                  value={profile.notes}
                  disabled={!editable}
                  onChange={(e) => setField('notes', e.target.value)}
                />
              </label>
              {editable && (
                <Button
                  onClick={() => void saveProfile()}
                  disabled={profileSubmission.submitting}
                >
                  {t('suppliers.saveProfile')}
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('suppliers.checklist.title')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {checklist.loading ? (
                <p>{t('suppliers.loading')}</p>
              ) : checklist.error ? (
                <p role='alert'>{t('suppliers.loadFailed')}</p>
              ) : !visibleChecklist?.length ? (
                <p>{t('suppliers.checklist.empty')}</p>
              ) : (
                visibleChecklist.map((item) => (
                  <div
                    key={item.typeCode}
                    className='flex flex-wrap justify-between gap-2 rounded-md border border-border p-3'
                  >
                    <span>
                      {itemName(item.typeCode, item.name)}
                      {' · '}
                      {item.required
                        ? t('suppliers.settings.required')
                        : t('suppliers.checklist.optional')}
                      {' · '}
                      {item.checkValidity
                        ? t('suppliers.checklist.expirationRequired')
                        : t('suppliers.checklist.noExpirationCheck')}
                    </span>
                    <span>{t(`suppliers.checklist.${item.status}`)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          {supplier && (
            <Card>
              <CardHeader>
                <CardTitle>{t('suppliers.qualifications.title')}</CardTitle>
              </CardHeader>
              <CardContent className='space-y-6'>
                {supplier.qualifications.some((q) => q.stage === 'current') && (
                  <section className='space-y-2'>
                    <h3 className='font-medium'>
                      {t('suppliers.qualifications.current')}
                    </h3>
                    {supplier.qualifications
                      .filter((q) => q.stage === 'current')
                      .map((q) => (
                        <div
                          key={q.id}
                          className='rounded-md border border-border p-3 text-sm'
                        >
                          <p>
                            {typeName(q.typeCode)} · {q.validUntil}
                          </p>
                          {q.file && (
                            <FileList files={[q.file as FileRecord]} />
                          )}
                        </div>
                      ))}
                  </section>
                )}
                {canEditQualifications && (
                  <section className='space-y-4'>
                    <h3 className='font-medium'>
                      {canRenew
                        ? t('suppliers.qualifications.renewal')
                        : t('suppliers.qualifications.proposed')}
                    </h3>
                    {drafts.map((row, index) => (
                      <div
                        key={row.clientId}
                        className='space-y-3 rounded-md border border-border p-4'
                      >
                        <div className='grid gap-3 sm:grid-cols-3'>
                          <label className='space-y-1 text-sm'>
                            <span>{t('suppliers.fields.type')}</span>
                            <select
                              className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                              value={row.typeCode}
                              onChange={(e) =>
                                setDrafts((old) =>
                                  old.map((item, i) =>
                                    i === index
                                      ? { ...item, typeCode: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {notApplicable(row) && (
                                <option value={row.typeCode} disabled>
                                  {typeName(row.typeCode)}
                                </option>
                              )}
                              {applicableTypes.map(
                                (type: QualificationType) => (
                                  <option key={type.code} value={type.code}>
                                    {typeName(type.code)}
                                    {applicableRules.find(
                                      (rule) => rule.typeCode === type.code,
                                    )?.required
                                      ? ' *'
                                      : ''}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className='space-y-1 text-sm'>
                            <span>
                              {t('suppliers.fields.certificateNumber')}
                            </span>
                            <Input
                              value={row.certificateNumber}
                              onChange={(e) =>
                                setDrafts((old) =>
                                  old.map((item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          certificateNumber: e.target.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label className='space-y-1 text-sm'>
                            <span>{t('suppliers.fields.validUntil')}</span>
                            <Input
                              type='date'
                              value={row.validUntil}
                              onChange={(e) =>
                                setDrafts((old) =>
                                  old.map((item, i) =>
                                    i === index
                                      ? { ...item, validUntil: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                        {notApplicable(row) && (
                          <p role='alert' className='text-sm text-destructive'>
                            {t('suppliers.blocked.notApplicableRow')}
                          </p>
                        )}
                        <FileUploadField
                          repository={files}
                          value={row.file ? [row.file as FileRecord] : []}
                          onChange={(value) =>
                            setDrafts((old) =>
                              old.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      file: (value[0] as SupplierFile) ?? null,
                                    }
                                  : item,
                              ),
                            )
                          }
                          onStatusChange={(status) =>
                            setBusyUpload(status !== 'idle')
                          }
                        />
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() =>
                            setDrafts((old) =>
                              old.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {t('suppliers.remove')}
                        </Button>
                      </div>
                    ))}
                    {blockers.length > 0 && (
                      <div
                        role='alert'
                        className='space-y-1 rounded-md border border-destructive/50 p-3 text-sm text-destructive'
                      >
                        <p className='font-medium'>
                          {t('suppliers.blocked.title')}
                        </p>
                        <ul className='list-disc space-y-1 pl-5'>
                          {blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        variant='outline'
                        onClick={() =>
                          setDrafts((old) => [...old, emptyDraft()])
                        }
                      >
                        {t('suppliers.addQualification')}
                      </Button>
                      <Button
                        variant='outline'
                        onClick={() => void saveQualifications()}
                        disabled={
                          qualificationSubmission.submitting || busyUpload
                        }
                      >
                        {t('suppliers.saveQualifications')}
                      </Button>
                      <Button
                        onClick={() => void submit()}
                        disabled={
                          submitSubmission.submitting ||
                          busyUpload ||
                          blockers.length > 0
                        }
                      >
                        {canRenew
                          ? t('suppliers.submitRenewal')
                          : t('suppliers.submit')}
                      </Button>
                    </div>
                  </section>
                )}
              </CardContent>
            </Card>
          )}
          {supplier && supplier.events.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('suppliers.history')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className='space-y-2 text-sm'>
                  {supplier.events.map((event) => (
                    <li key={event.id} className='border-b border-border pb-2'>
                      {t(`suppliers.actions.${event.action}`)} ·{' '}
                      {new Date(event.createdAt).toLocaleString()}
                      {event.note ? ` · ${event.note}` : ''}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {message && (
            <p role='status' className='text-sm'>
              {message}
            </p>
          )}
        </>
      )}
    </PageContainer>
  );
}
