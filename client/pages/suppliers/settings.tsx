import { useApiClient, useSubmission } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import type { LifecycleDescription } from '@nocobase/lifecycle';
import { LifecycleDiagram } from '#components/lifecycle-diagram';
import { Button } from '#components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import { Input } from '#components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useListData } from '#hooks/use-list-data';
import { SettingsModulePage } from '../settings/settings-module-page.js';
import {
  supplierCategories,
  type AdmissionRule,
  type QualificationType,
} from './model.js';

interface Settings {
  reviewerId: string;
  warningDays: number;
  revision: number;
}
interface ReviewerOption {
  id: string;
  name: string;
  email: string;
}
interface ProcessDefinition {
  id: string;
  description: LifecycleDescription;
  settings: Settings;
}
interface ProcessEvent {
  id: string;
  supplierId: string;
  supplierName: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  note?: string;
  createdAt: string;
}
const emptyType = {
  code: '',
  name: '',
  category: 'all' as const,
  required: false,
  enabled: true,
};

export default function SupplierSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const settings = useListData<{ data: Settings }>('supplierSettings');
  const reviewers = useListData<{ data: ReviewerOption[] }>(
    'supplierSettings/reviewerOptions',
  );
  const types = useListData<{ data: QualificationType[] }>(
    'supplierQualificationTypes',
  );
  const rules = useListData<{ data: AdmissionRule[] }>(
    'supplierAdmissionRules',
  );
  const process = useListData<{ data: ProcessDefinition }>(
    'supplierSettings/process',
  );
  const executions = useListData<{ data: ProcessEvent[] }>(
    'supplierSettings/process/executions',
  );
  const [processTab, setProcessTab] = useState<'definitions' | 'executions'>(
    'definitions',
  );
  const [reviewerId, setReviewerId] = useState('');
  const [warningDays, setWarningDays] = useState(30);
  const [newType, setNewType] = useState(emptyType);
  const [category, setCategory] =
    useState<AdmissionRule['category']>('equipment');
  const [draftRules, setDraftRules] = useState<AdmissionRule[]>();
  const [addCode, setAddCode] = useState('');
  const [message, setMessage] = useState('');
  const policySubmission = useSubmission({ scope: 'supplier:settings' });
  const typeSubmission = useSubmission({ scope: 'supplier:type' });
  const rulesSubmission = useSubmission({ scope: 'supplier:rules' });
  const currentRules =
    draftRules ??
    rules.data?.data.filter((row) => row.category === category) ??
    [];
  useEffect(() => {
    if (settings.data?.data) {
      const { reviewerId: nextReviewerId, warningDays: nextWarningDays } =
        settings.data.data;
      queueMicrotask(() => {
        setReviewerId(nextReviewerId);
        setWarningDays(nextWarningDays);
      });
    }
  }, [settings.data?.data]);
  const savePolicy = async () => {
    if (!settings.data?.data) return;
    setMessage('');
    try {
      await policySubmission.run(
        { reviewerId, warningDays, revision: settings.data.data.revision },
        async (key, signal, value) =>
          api.request({
            path: 'supplierSettings',
            method: 'PATCH',
            json: value,
            headers: { 'Idempotency-Key': key },
            signal,
          }),
      );
      settings.reload();
      setMessage(t('suppliers.saved'));
    } catch {
      setMessage(t('suppliers.saveFailed'));
    }
  };
  const addType = async () => {
    setMessage('');
    try {
      await typeSubmission.run(newType, async (key, signal, value) =>
        api.request({
          path: 'supplierQualificationTypes',
          method: 'POST',
          json: value,
          headers: { 'Idempotency-Key': key },
          signal,
        }),
      );
      setNewType(emptyType);
      types.reload();
      setMessage(t('suppliers.saved'));
    } catch {
      setMessage(t('suppliers.saveFailed'));
    }
  };
  const saveRules = async () => {
    setMessage('');
    try {
      await rulesSubmission.run(
        { category, rows: currentRules },
        async (key, signal, value) =>
          api.request({
            path: `supplierAdmissionRules/${value.category}`,
            method: 'PUT',
            json: value.rows.map(
              ({ typeCode, required, checkValidity, enabled }) => ({
                typeCode,
                required,
                checkValidity,
                enabled,
              }),
            ),
            headers: { 'Idempotency-Key': key },
            signal,
          }),
      );
      setDraftRules(undefined);
      rules.reload();
      setMessage(t('suppliers.saved'));
    } catch {
      setMessage(t('suppliers.saveFailed'));
    }
  };
  return (
    <SettingsModulePage
      title={t('suppliers.settings.title')}
      description={t('suppliers.settings.description')}
    >
      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle>{t('suppliers.settings.policy')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {settings.loading || reviewers.loading ? (
              <p>{t('suppliers.loading')}</p>
            ) : settings.error || reviewers.error ? (
              <p role='alert'>{t('suppliers.loadFailed')}</p>
            ) : (
              <>
                <label className='block max-w-md space-y-1 text-sm'>
                  <span>{t('suppliers.settings.reviewer')}</span>
                  <select
                    className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                    value={reviewerId}
                    onChange={(e) => setReviewerId(e.target.value)}
                  >
                    {reviewers.data?.data.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} · {user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className='block max-w-32 space-y-1 text-sm'>
                  <span>{t('suppliers.settings.warningDays')}</span>
                  <Input
                    type='number'
                    min={1}
                    max={365}
                    value={warningDays}
                    onChange={(e) => setWarningDays(Number(e.target.value))}
                  />
                </label>
                <Button
                  onClick={() => void savePolicy()}
                  disabled={policySubmission.submitting}
                >
                  {t('suppliers.settings.save')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('suppliers.settings.types')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <label className='block max-w-xs space-y-1 text-sm'>
              <span>{t('suppliers.fields.category')}</span>
              <select
                className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as AdmissionRule['category']);
                  setDraftRules(undefined);
                }}
              >
                {supplierCategories.map((value) => (
                  <option key={value} value={value}>
                    {t(`suppliers.categories.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {types.loading || rules.loading ? (
              <p>{t('suppliers.loading')}</p>
            ) : types.error || rules.error ? (
              <p role='alert'>{t('suppliers.loadFailed')}</p>
            ) : (
              <div className='overflow-x-auto rounded-md border border-border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('suppliers.fields.type')}</TableHead>
                      <TableHead>{t('suppliers.settings.required')}</TableHead>
                      <TableHead>
                        {t('suppliers.settings.checkValidity')}
                      </TableHead>
                      <TableHead>{t('suppliers.settings.enabled')}</TableHead>
                      <TableHead>{t('suppliers.remove')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentRules.map((row) => (
                      <TableRow key={row.typeCode}>
                        <TableCell>
                          {row.typeCode === 'business-license'
                            ? t('suppliers.qualificationTypes.businessLicense')
                            : row.name}
                        </TableCell>
                        {(
                          ['required', 'checkValidity', 'enabled'] as const
                        ).map((key) => (
                          <TableCell key={key}>
                            <Button
                              variant='outline'
                              size='sm'
                              onClick={() =>
                                setDraftRules(
                                  currentRules.map((item) =>
                                    item.typeCode === row.typeCode
                                      ? { ...item, [key]: !item[key] }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {row[key]
                                ? t('suppliers.yes')
                                : t('suppliers.no')}
                            </Button>
                          </TableCell>
                        ))}
                        <TableCell>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() =>
                              setDraftRules(
                                currentRules.filter(
                                  (item) => item.typeCode !== row.typeCode,
                                ),
                              )
                            }
                          >
                            {t('suppliers.remove')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className='flex flex-wrap gap-2'>
              <select
                className='flex h-9 rounded-md border border-input bg-background px-3 text-sm'
                aria-label={t('suppliers.settings.addRule')}
                value={addCode}
                onChange={(e) => setAddCode(e.target.value)}
              >
                <option value=''>{t('suppliers.settings.chooseType')}</option>
                {types.data?.data
                  .filter(
                    (type) =>
                      type.enabled &&
                      !currentRules.some((rule) => rule.typeCode === type.code),
                  )
                  .map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.code === 'business-license'
                        ? t('suppliers.qualificationTypes.businessLicense')
                        : type.name}
                    </option>
                  ))}
              </select>
              <Button
                variant='outline'
                disabled={!addCode}
                onClick={() => {
                  const type = types.data?.data.find(
                    (item) => item.code === addCode,
                  );
                  if (type)
                    setDraftRules([
                      ...currentRules,
                      {
                        category,
                        typeCode: type.code,
                        name: type.name,
                        required: true,
                        checkValidity: true,
                        enabled: true,
                      },
                    ]);
                  setAddCode('');
                }}
              >
                {t('suppliers.settings.addRule')}
              </Button>
              <Button
                disabled={rulesSubmission.submitting}
                onClick={() => void saveRules()}
              >
                {t('suppliers.settings.saveRules')}
              </Button>
            </div>
            <div className='grid gap-3 sm:grid-cols-3'>
              <label className='space-y-1 text-sm'>
                <span>{t('suppliers.settings.code')}</span>
                <Input
                  value={newType.code}
                  onChange={(e) =>
                    setNewType((old) => ({ ...old, code: e.target.value }))
                  }
                />
              </label>
              <label className='space-y-1 text-sm'>
                <span>{t('suppliers.settings.name')}</span>
                <Input
                  value={newType.name}
                  onChange={(e) =>
                    setNewType((old) => ({ ...old, name: e.target.value }))
                  }
                />
              </label>
              <div className='flex items-end'>
                <Button
                  variant='outline'
                  onClick={() => void addType()}
                  disabled={typeSubmission.submitting}
                >
                  {t('suppliers.settings.addType')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('suppliers.settings.process')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex gap-2'>
              <Button
                variant={processTab === 'definitions' ? 'default' : 'outline'}
                onClick={() => setProcessTab('definitions')}
              >
                {t('suppliers.settings.definitions')}
              </Button>
              <Button
                variant={processTab === 'executions' ? 'default' : 'outline'}
                onClick={() => setProcessTab('executions')}
              >
                {t('suppliers.settings.executions')}
              </Button>
            </div>
            {processTab === 'definitions' ? (
              process.loading ? (
                <p>{t('suppliers.loading')}</p>
              ) : process.error || !process.data?.data ? (
                <p role='alert'>{t('suppliers.loadFailed')}</p>
              ) : (
                <>
                  <div className='rounded-md border border-border p-3 text-sm'>
                    <p className='font-medium'>
                      {t('suppliers.settings.processName')}
                    </p>
                    <p>
                      {t('suppliers.settings.reviewer')}:{' '}
                      {reviewers.data?.data.find(
                        (user) =>
                          user.id === process.data?.data.settings.reviewerId,
                      )?.name ?? process.data.data.settings.reviewerId}
                    </p>
                    <p>
                      {t('suppliers.settings.warningDays')}:{' '}
                      {process.data.data.settings.warningDays}
                    </p>
                  </div>
                  <LifecycleDiagram
                    description={process.data.data.description}
                    ariaLabel={t('suppliers.settings.processName')}
                    stateLabel={(state) => t(`suppliers.status.${state.name}`)}
                    transitionLabel={(transition) =>
                      t(`suppliers.processTransitions.${transition.name}`)
                    }
                    presentation='process'
                    autoHeight
                  />
                </>
              )
            ) : executions.loading ? (
              <p>{t('suppliers.loading')}</p>
            ) : executions.error ? (
              <p role='alert'>{t('suppliers.loadFailed')}</p>
            ) : executions.data?.data.length ? (
              <div className='overflow-x-auto rounded-md border border-border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('suppliers.fields.name')}</TableHead>
                      <TableHead>{t('suppliers.fields.status')}</TableHead>
                      <TableHead>{t('suppliers.history')}</TableHead>
                      <TableHead>{t('suppliers.fields.updatedAt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.data.data.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>
                          <Link
                            className='text-primary hover:underline'
                            to={`/suppliers/${event.supplierId}`}
                          >
                            {event.supplierName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {t(`suppliers.status.${event.toStatus}`)}
                        </TableCell>
                        <TableCell>
                          {t(`suppliers.actions.${event.action}`)}
                          {event.note ? ` · ${event.note}` : ''}
                        </TableCell>
                        <TableCell>
                          {new Date(event.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p>{t('suppliers.settings.noExecutions')}</p>
            )}
          </CardContent>
        </Card>
        {message && (
          <p role='status' className='text-sm'>
            {message}
          </p>
        )}
      </div>
    </SettingsModulePage>
  );
}
