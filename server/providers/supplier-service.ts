import { randomUUID } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import { serverFileRepositoryManagerToken } from '@nocobase/app-plugin-file/server';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import type { ServiceContainer } from '@nocobase/service-provider';
import { buildFilter } from '@nocobase/repository-input';

/** Supplier categories; each one owns an independent set of admission rules. */
export const supplierCategories = [
  'equipment',
  'service',
  'both',
  'testing',
] as const;
export type SupplierCategory = (typeof supplierCategories)[number];

export interface SupplierProfileInput {
  name: string;
  creditCode: string;
  category: SupplierCategory;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address?: string;
  notes?: string;
}
export interface QualificationInput {
  typeCode: string;
  certificateNumber?: string;
  validUntil?: string | null;
  fileId: string;
}

const error = (
  status:
    | 'NOT_FOUND'
    | 'PERMISSION_DENIED'
    | 'FAILED_PRECONDITION'
    | 'ALREADY_EXISTS'
    | 'ABORTED',
  reason: string,
) => new ApiError({ status, domain: 'suppliers', reason, message: reason });
const statuses = ['approved', 'renewalPending', 'renewalReturned'];
const editable = ['draft', 'returned'];
const proposedEditable = [...editable, 'approved', 'renewalReturned'];
const today = () => new Date().toISOString().slice(0, 10);
export const isValidCalendarDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};
type SupplierRow = {
  id: string;
  ownerId: string;
  status: string;
  version: number;
  category: string;
  reviewerId?: string | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
};
type AdmissionRequirement = {
  typeCode: string;
  name: string;
  required: boolean;
  checkValidity: boolean;
};
type AdmissionResult = AdmissionRequirement & {
  fileId: string | null;
  validUntil: string | null;
  status: 'complete' | 'missing' | 'expired' | 'dateMissing' | 'notProvided';
};
type ReviewDetail = SupplierRow & {
  name: string;
  creditCode: string;
  qualifications: {
    id: string;
    typeCode: string;
    stage: string;
    file: {
      id: string;
      filename: string;
      mimeType: string;
      contentUrl: string;
    } | null;
  }[];
  events: {
    id: string;
    action: string;
    note: string | null;
    createdAt: string | Date;
  }[];
  submissions: {
    id: string;
    source: string;
    submittedAt: string | Date;
    requirements: AdmissionRequirement[];
    results: AdmissionResult[];
  }[];
};
const timeOf = (value: string | Date) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export class SupplierService {
  private readonly db;
  constructor(
    private readonly container: ServiceContainer,
    private readonly basePath = '',
  ) {
    this.db = container.resolve(databaseManagerToken);
  }
  private connection() {
    return this.db.connection();
  }
  async settings(connection: DatabaseConnection = this.connection()) {
    const row = await connection
      .repository('supplierSettings')
      .findOne({ filter: { id: 'default' } });
    if (!row) throw error('FAILED_PRECONDITION', 'SETTINGS_MISSING');
    return row;
  }
  async isReviewer(userId: string) {
    return (await this.settings()).reviewerId === userId;
  }
  async requireReviewer(userId: string, supplierOwnerId?: unknown) {
    if (!(await this.isReviewer(userId)) || userId === supplierOwnerId)
      throw error('PERMISSION_DENIED', 'REVIEWER_REQUIRED');
  }
  async my(userId: string) {
    const supplier = await this.connection()
      .repository('suppliers')
      .findOne({ filter: { ownerId: userId } });
    return {
      supplier: supplier ? await this.detail(supplier.id as string) : null,
      types: await this.connection()
        .repository('supplierQualificationTypes')
        .findMany({
          filter: { enabled: true },
          sort: (s) => s.field('code').asc(),
        }),
      rules: await this.rules(),
      reviewer: await this.isReviewer(userId),
    };
  }
  async detail(id: string, connection: DatabaseConnection = this.connection()) {
    const supplier = (await connection
      .repository('suppliers')
      .findOne({ filter: { id } })) as SupplierRow | undefined;
    if (!supplier) throw error('NOT_FOUND', 'SUPPLIER_NOT_FOUND');
    const [qualifications, events, snapshots] = await Promise.all([
      connection.repository('supplierQualifications').findMany({
        filter: { supplierId: id },
        sort: (s) => s.field('createdAt').desc(),
      }),
      connection.repository('supplierReviewEvents').findMany({
        filter: { supplierId: id },
        sort: (s) => s.field('createdAt').desc(),
      }),
      connection.repository('supplierSubmissionSnapshots').findMany({
        filter: { supplierId: id },
        sort: (s) => s.field('submittedAt').desc(),
      }),
    ]);
    const files = this.container
      .resolve(serverFileRepositoryManagerToken)
      .repository('supplierFiles', {
        connection: 'main',
        disk: 'local',
        accessPath: '/uploads/supplierQualifications',
        policy: { read: true, create: false, update: false, delete: false },
      });
    const fileRows = qualifications.length
      ? await connection.repository('supplierFiles').findMany({
          filter: buildFilter((f) =>
            f.or(
              qualifications.map((q) => f.string('id').eq(q.fileId as string)),
            ),
          ),
        })
      : [];
    const fileMap = new Map(
      fileRows.map((file) => [
        file.id,
        {
          id: file.id,
          filename: file.filename,
          ext: file.ext,
          mimeType: file.mimeType,
          size: file.size,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          contentUrl: `${this.basePath.replace(/\/$/, '')}${files.getUrl(file as { id: string; ext: string })}`,
        },
      ]),
    );
    return {
      ...supplier,
      qualifications: qualifications.map((q) => ({
        ...q,
        file: fileMap.get(q.fileId) ?? null,
      })),
      events,
      submissions: snapshots,
    };
  }
  async reviewBrief(actorId: string, id: string) {
    const detail = (await this.detail(id)) as unknown as ReviewDetail;
    await this.requireReviewer(actorId, detail.ownerId);
    if (!['pending', 'renewalPending'].includes(String(detail.status)))
      throw error('FAILED_PRECONDITION', 'NOT_PENDING');
    const snapshot = detail.submissions[0];
    if (!snapshot)
      throw error('FAILED_PRECONDITION', 'SUBMISSION_SNAPSHOT_MISSING');
    const requirements = snapshot.requirements;
    const { results } = await this.evaluate(
      this.connection(),
      detail,
      requirements,
    );
    const settings = await this.settings();
    const warningDate = new Date();
    warningDate.setUTCDate(
      warningDate.getUTCDate() + Number(settings.warningDays),
    );
    const warningUntil = warningDate.toISOString().slice(0, 10);
    const proposed = detail.qualifications.filter(
      (row) => row.stage === 'proposed',
    );
    const findings = results.map((result) => {
      const qualification = proposed.find(
        (row) => row.typeCode === result.typeCode,
      );
      const severity =
        result.status === 'missing' ||
        result.status === 'expired' ||
        result.status === 'dateMissing'
          ? result.required || result.fileId
            ? 'blocking'
            : 'info'
          : result.checkValidity &&
              result.validUntil &&
              result.validUntil <= warningUntil
            ? 'warning'
            : 'info';
      return {
        ...result,
        severity,
        qualificationId: qualification?.id ?? null,
        file: qualification?.file ?? null,
        evidence: {
          snapshotId: snapshot.id,
          submittedAt: snapshot.submittedAt,
          qualificationId: qualification?.id ?? null,
          fileId: result.fileId,
        },
        contentVerified: false,
      };
    });
    const submittedAt = timeOf(snapshot.submittedAt);
    const previousReturn = detail.events.find(
      (event) =>
        event.action === 'return' && timeOf(event.createdAt) < submittedAt,
    );
    const previousSnapshot = previousReturn
      ? detail.submissions.find(
          (row) => timeOf(row.submittedAt) < timeOf(previousReturn.createdAt),
        )
      : null;
    const previousResults = previousSnapshot?.results ?? [];
    const changes = previousReturn
      ? findings.map((finding) => {
          const before = previousResults.find(
            (row) => row.typeCode === finding.typeCode,
          );
          const changed = Boolean(
            before &&
            (before.fileId !== finding.fileId ||
              before.validUntil !== finding.validUntil),
          );
          return {
            typeCode: finding.typeCode,
            name: finding.name,
            previousStatus: before?.status ?? null,
            currentStatus: finding.status,
            changed,
            outcome:
              finding.severity === 'blocking'
                ? 'unresolved'
                : changed
                  ? 'supplemented'
                  : 'uncertain',
            previousSnapshotId: previousSnapshot?.id ?? null,
          };
        })
      : [];
    return {
      supplier: {
        id: detail.id,
        name: detail.name,
        creditCode: detail.creditCode,
        category: detail.category,
        status: detail.status,
        version: detail.version,
      },
      snapshot: {
        id: snapshot.id,
        source: snapshot.source,
        submittedAt: snapshot.submittedAt,
        requirements,
      },
      checkedAt: new Date().toISOString(),
      warningDays: Number(settings.warningDays),
      findings,
      previousReturn: previousReturn
        ? {
            id: previousReturn.id,
            note: previousReturn.note,
            createdAt: previousReturn.createdAt,
            previousSnapshotId: previousSnapshot?.id ?? null,
          }
        : null,
      changes,
    };
  }
  async rules(connection: DatabaseConnection = this.connection()) {
    const [rules, types] = await Promise.all([
      connection.repository('supplierAdmissionRules').findMany({
        sort: (s) => s.field('category').asc(),
      }),
      connection.repository('supplierQualificationTypes').findMany({}),
    ]);
    const names = new Map(types.map((type) => [type.code, type.name]));
    return rules.map((rule) => ({
      ...rule,
      name: names.get(rule.typeCode) ?? rule.typeCode,
    }));
  }
  async replaceRules(
    category: string,
    input: readonly {
      typeCode: string;
      required: boolean;
      checkValidity: boolean;
      enabled: boolean;
    }[],
  ) {
    return this.db.transaction(async (connection) => {
      if (!input.some((row) => row.required && row.enabled))
        throw error('FAILED_PRECONDITION', 'NO_REQUIRED_QUALIFICATIONS');
      if (new Set(input.map((row) => row.typeCode)).size !== input.length)
        throw error('FAILED_PRECONDITION', 'DUPLICATE_QUALIFICATION_TYPE');
      const types = await connection
        .repository('supplierQualificationTypes')
        .findMany({});
      if (
        input.some(
          (row) =>
            !types.some((type) => type.code === row.typeCode && type.enabled),
        )
      )
        throw error('FAILED_PRECONDITION', 'INVALID_QUALIFICATION_TYPE');
      const existing = await connection
        .repository('supplierAdmissionRules')
        .findMany({ filter: { category } });
      if (
        existing.length === input.length &&
        input.every((row) =>
          existing.some(
            (current) =>
              current.typeCode === row.typeCode &&
              Boolean(current.required) === row.required &&
              Boolean(current.checkValidity) === row.checkValidity &&
              Boolean(current.enabled) === row.enabled,
          ),
        )
      )
        return this.rules(connection);
      await connection
        .repository('supplierAdmissionRules')
        .deleteMany({ filter: { category } });
      const now = new Date();
      for (const row of input)
        await connection.repository('supplierAdmissionRules').createOne({
          values: {
            id: randomUUID(),
            category,
            ...row,
            createdAt: now,
            updatedAt: now,
          },
        });
      return this.rules(connection);
    });
  }
  private async requirements(
    connection: DatabaseConnection,
    category: string,
  ): Promise<AdmissionRequirement[]> {
    const rules = (await this.rules(connection)) as Array<{
      category: string;
      enabled: boolean;
      typeCode: string;
      name: string;
      required: boolean;
      checkValidity: boolean;
    }>;
    return rules
      .filter((rule) => rule.category === category && rule.enabled)
      .map((rule) => ({
        typeCode: String(rule.typeCode),
        name: String(rule.name),
        required: Boolean(rule.required),
        checkValidity: Boolean(rule.checkValidity),
      }));
  }
  private async evaluate(
    connection: DatabaseConnection,
    supplier: SupplierRow,
    requirements: AdmissionRequirement[],
  ) {
    const rows = await connection
      .repository('supplierQualifications')
      .findMany({
        filter: { supplierId: supplier.id, stage: 'proposed' },
      });
    const results: AdmissionResult[] = requirements.map((rule) => {
      const matching = rows.find((row) => row.typeCode === rule.typeCode);
      const validUntil =
        typeof matching?.validUntil === 'string' ? matching.validUntil : null;
      let status: AdmissionResult['status'] = 'complete';
      if (!matching || !matching.fileId)
        status = rule.required ? 'missing' : 'notProvided';
      else if (rule.checkValidity && !validUntil) status = 'dateMissing';
      else if (rule.checkValidity && validUntil && validUntil < today())
        status = 'expired';
      return {
        ...rule,
        fileId: matching ? (matching.fileId as string) : null,
        validUntil,
        status,
      };
    });
    return { results, rows };
  }
  async checklist(userId: string, category: string) {
    const supplier = (await this.connection()
      .repository('suppliers')
      .findOne({ filter: { ownerId: userId } })) as SupplierRow | undefined;
    const requirements = await this.requirements(this.connection(), category);
    if (!supplier || supplier.category !== category) {
      return requirements.map((rule) => ({
        ...rule,
        fileId: null,
        validUntil: null,
        status: rule.required ? ('missing' as const) : ('notProvided' as const),
      }));
    }
    return (await this.evaluate(this.connection(), supplier, requirements))
      .results;
  }
  async ownDetail(userId: string, id: string) {
    const row = await this.detail(id);
    if (row.ownerId !== userId)
      throw error('PERMISSION_DENIED', 'SUPPLIER_NOT_OWNED');
    return row;
  }
  async saveProfile(userId: string, input: SupplierProfileInput) {
    return this.db.transaction(async (connection) => {
      const repo = connection.repository('suppliers');
      const existing = (await repo.findOne({ filter: { ownerId: userId } })) as
        SupplierRow | undefined;
      const now = new Date();
      if (existing) {
        if (!editable.includes(String(existing.status)))
          throw error('FAILED_PRECONDITION', 'PROFILE_LOCKED');
        const other = await repo.findOne({
          filter: { creditCode: input.creditCode },
        });
        if (other && other.id !== existing.id)
          throw error('ALREADY_EXISTS', 'CREDIT_CODE_EXISTS');
        await repo.updateOne({
          filter: { id: existing.id },
          values: {
            ...input,
            version: Number(existing.version) + 1,
            updatedAt: now,
          },
        });
        return this.detail(String(existing.id), connection);
      }
      if (await repo.findOne({ filter: { creditCode: input.creditCode } }))
        throw error('ALREADY_EXISTS', 'CREDIT_CODE_EXISTS');
      const id = randomUUID();
      await repo.createOne({
        values: {
          id,
          ownerId: userId,
          ...input,
          status: 'draft',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      return this.detail(id, connection);
    });
  }
  async saveQualifications(
    userId: string,
    input: readonly QualificationInput[],
  ) {
    return this.db.transaction(async (connection) => {
      const supplier = (await connection
        .repository('suppliers')
        .findOne({ filter: { ownerId: userId } })) as SupplierRow | undefined;
      if (!supplier) throw error('NOT_FOUND', 'SUPPLIER_NOT_FOUND');
      if (!proposedEditable.includes(String(supplier.status)))
        throw error('FAILED_PRECONDITION', 'QUALIFICATIONS_LOCKED');
      const rules = await this.requirements(
        connection,
        String(supplier.category),
      );
      for (const qualification of input) {
        if (
          qualification.validUntil &&
          !isValidCalendarDate(qualification.validUntil)
        )
          throw error('FAILED_PRECONDITION', 'INVALID_QUALIFICATION_DATE');
        if (!rules.some((rule) => rule.typeCode === qualification.typeCode))
          throw error('FAILED_PRECONDITION', 'INVALID_QUALIFICATION_TYPE');
        const file = await connection
          .repository('supplierFiles')
          .findOne({ filter: { id: qualification.fileId, ownerId: userId } });
        if (!file) throw error('PERMISSION_DENIED', 'FILE_NOT_OWNED');
      }
      const repo = connection.repository('supplierQualifications');
      await repo.deleteMany({
        filter: { supplierId: supplier.id, stage: 'proposed' },
      });
      const now = new Date();
      for (const row of input)
        await repo.createOne({
          values: {
            id: randomUUID(),
            supplierId: supplier.id,
            ...row,
            stage: 'proposed',
            createdAt: now,
            updatedAt: now,
          },
        });
      return this.detail(String(supplier.id), connection);
    });
  }
  private async validateSubmission(
    connection: DatabaseConnection,
    supplier: SupplierRow,
  ) {
    const requirements = await this.requirements(
      connection,
      String(supplier.category),
    );
    if (!requirements.some((rule) => rule.required))
      throw error('FAILED_PRECONDITION', 'NO_REQUIRED_QUALIFICATIONS');
    const { results, rows } = await this.evaluate(
      connection,
      supplier,
      requirements,
    );
    if (
      rows.some(
        (row) => !requirements.some((rule) => rule.typeCode === row.typeCode),
      )
    )
      throw error('FAILED_PRECONDITION', 'INVALID_QUALIFICATION_TYPE');
    if (new Set(rows.map((row) => row.typeCode)).size !== rows.length)
      throw error('FAILED_PRECONDITION', 'DUPLICATE_QUALIFICATION_TYPE');
    const invalid = results.find(
      (result) =>
        (result.required || result.fileId) && result.status !== 'complete',
    );
    if (invalid)
      throw error(
        'FAILED_PRECONDITION',
        `${invalid.status.toUpperCase()}:${invalid.typeCode}`,
      );
    return { requirements, results };
  }
  private async transition(
    connection: DatabaseConnection,
    supplier: SupplierRow,
    actorId: string,
    action: string,
    toStatus: string,
    note: string | null,
    key: string,
  ) {
    const previous = await connection
      .repository('supplierReviewEvents')
      .findOne({ filter: { supplierId: supplier.id, operationKey: key } });
    if (previous) {
      if (previous.action !== action || previous.actorId !== actorId)
        throw error('ABORTED', 'OPERATION_CONFLICT');
      return;
    }
    const updated = await connection.repository('suppliers').updateMany({
      filter: {
        id: supplier.id,
        status: supplier.status,
        version: supplier.version,
      },
      values: {
        status: toStatus,
        version: Number(supplier.version) + 1,
        reviewerId:
          action === 'approve' || action === 'return'
            ? actorId
            : supplier.reviewerId,
        reviewedAt:
          action === 'approve' || action === 'return'
            ? new Date()
            : supplier.reviewedAt,
        reviewNote: note,
        updatedAt: new Date(),
      },
    });
    if (updated.updatedCount !== 1) throw error('ABORTED', 'STALE_SUPPLIER');
    await connection.repository('supplierReviewEvents').createOne({
      values: {
        id: randomUUID(),
        supplierId: supplier.id,
        actorId,
        action,
        fromStatus: supplier.status,
        toStatus,
        note,
        operationKey: key,
        createdAt: new Date(),
      },
    });
  }
  async submit(userId: string, key: string) {
    return this.db.transaction(async (connection) => {
      const supplier = (await connection
        .repository('suppliers')
        .findOne({ filter: { ownerId: userId } })) as SupplierRow | undefined;
      if (!supplier) throw error('NOT_FOUND', 'SUPPLIER_NOT_FOUND');
      const replay = await connection
        .repository('supplierReviewEvents')
        .findOne({ filter: { supplierId: supplier.id, operationKey: key } });
      if (replay) {
        if (replay.action !== 'submit' || replay.actorId !== userId)
          throw error('ABORTED', 'OPERATION_CONFLICT');
        return this.detail(supplier.id, connection);
      }
      if (!proposedEditable.includes(String(supplier.status)))
        throw error('FAILED_PRECONDITION', 'SUBMISSION_LOCKED');
      const check = await this.validateSubmission(connection, supplier);
      await this.transition(
        connection,
        supplier,
        userId,
        'submit',
        statuses.includes(String(supplier.status))
          ? 'renewalPending'
          : 'pending',
        null,
        key,
      );
      const event = await connection
        .repository('supplierReviewEvents')
        .findOne({ filter: { supplierId: supplier.id, operationKey: key } });
      await connection.repository('supplierSubmissionSnapshots').createOne({
        values: {
          id: randomUUID(),
          supplierId: supplier.id,
          submitEventId: event?.id,
          category: supplier.category,
          source: 'submission',
          requirements: check.requirements,
          results: check.results,
          submittedAt: new Date(),
        },
      });
      return this.detail(String(supplier.id), connection);
    });
  }
  async decide(
    actorId: string,
    id: string,
    action: 'approve' | 'return',
    note: string | null,
    key: string,
    expectedVersion?: number,
  ) {
    return this.db.transaction(async (connection) => {
      const supplier = (await connection
        .repository('suppliers')
        .findOne({ filter: { id } })) as SupplierRow | undefined;
      if (!supplier) throw error('NOT_FOUND', 'SUPPLIER_NOT_FOUND');
      const settings = await this.settings(connection);
      if (settings.reviewerId !== actorId || supplier.ownerId === actorId)
        throw error('PERMISSION_DENIED', 'REVIEWER_REQUIRED');
      const replay = await connection
        .repository('supplierReviewEvents')
        .findOne({ filter: { supplierId: supplier.id, operationKey: key } });
      if (replay) {
        if (replay.action !== action || replay.actorId !== actorId)
          throw error('ABORTED', 'OPERATION_CONFLICT');
        return this.detail(id, connection);
      }
      if (!['pending', 'renewalPending'].includes(String(supplier.status)))
        throw error('FAILED_PRECONDITION', 'NOT_PENDING');
      if (expectedVersion !== undefined && supplier.version !== expectedVersion)
        throw error('ABORTED', 'STALE_SUPPLIER');
      if (action === 'return' && !note?.trim())
        throw error('FAILED_PRECONDITION', 'RETURN_REASON_REQUIRED');
      if (action === 'approve') {
        const snapshot = await connection
          .repository('supplierSubmissionSnapshots')
          .findOne({
            filter: { supplierId: id },
            sort: (s) => s.field('submittedAt').desc(),
          });
        if (!snapshot)
          throw error('FAILED_PRECONDITION', 'SUBMISSION_SNAPSHOT_MISSING');
        const requirements = snapshot.requirements as AdmissionRequirement[];
        const { results } = await this.evaluate(
          connection,
          supplier,
          requirements,
        );
        const invalid = results.find(
          (result) =>
            (result.required || result.fileId) && result.status !== 'complete',
        );
        if (invalid)
          throw error(
            'FAILED_PRECONDITION',
            `${invalid.status.toUpperCase()}:${invalid.typeCode}`,
          );
        const repo = connection.repository('supplierQualifications');
        await repo.updateMany({
          filter: { supplierId: id, stage: 'current' },
          values: { stage: 'archived', updatedAt: new Date() },
        });
        await repo.updateMany({
          filter: { supplierId: id, stage: 'proposed' },
          values: { stage: 'current', updatedAt: new Date() },
        });
      }
      const toStatus =
        action === 'approve'
          ? 'approved'
          : supplier.status === 'pending'
            ? 'returned'
            : 'renewalReturned';
      await this.transition(
        connection,
        supplier,
        actorId,
        action,
        toStatus,
        note,
        key,
      );
      return this.detail(id, connection);
    });
  }
  async listQueue(status?: string, search?: string, page = 1) {
    const filter = buildFilter((f) =>
      f.and([
        ...(status
          ? [f.string('status').eq(status)]
          : [
              f.or(
                [
                  'pending',
                  'renewalPending',
                  'returned',
                  'renewalReturned',
                ].map((value) => f.string('status').eq(value)),
              ),
            ]),
        ...(search
          ? [
              f.or(
                ['name', 'creditCode'].map((field) =>
                  f.string(field).includes(search, { mode: 'insensitive' }),
                ),
              ),
            ]
          : []),
      ]),
    );
    return this.connection()
      .repository('suppliers')
      .findMany({
        filter,
        sort: (s) => s.field('updatedAt').desc(),
        limit: 20,
        offset: (page - 1) * 20,
      });
  }
  async directory(search?: string, page = 1) {
    const filter = buildFilter((f) =>
      f.and([
        f.or(statuses.map((value) => f.string('status').eq(value))),
        ...(search
          ? [
              f.or(
                ['name', 'creditCode'].map((field) =>
                  f.string(field).includes(search, { mode: 'insensitive' }),
                ),
              ),
            ]
          : []),
      ]),
    );
    const rows = await this.connection()
      .repository('suppliers')
      .findMany({
        filter,
        sort: (s) => s.field('name').asc(),
        limit: 20,
        offset: (page - 1) * 20,
      });
    const settings = await this.settings();
    const warningDate = new Date();
    warningDate.setUTCDate(
      warningDate.getUTCDate() + Number(settings.warningDays),
    );
    const limit = warningDate.toISOString().slice(0, 10);
    const qualificationRows = rows.length
      ? await this.connection()
          .query.selectFrom('supplierQualifications')
          .select(['supplierId', 'validUntil'])
          .where('stage', '=', 'current')
          .where(
            'supplierId',
            'in',
            rows.map((row) => row.id as string),
          )
          .execute()
      : [];
    const risks = new Map<string, 'expired' | 'expiring'>();
    for (const row of qualificationRows) {
      const supplierId = String(row.supplierId);
      if (String(row.validUntil) < today()) risks.set(supplierId, 'expired');
      else if (
        String(row.validUntil) <= limit &&
        risks.get(supplierId) !== 'expired'
      )
        risks.set(supplierId, 'expiring');
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      creditCode: row.creditCode,
      category: row.category,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail,
      status: row.status,
      updatedAt: row.updatedAt,
      expiryState: risks.get(row.id as string) ?? 'valid',
    }));
  }
  async expiring(page = 1) {
    const settings = await this.settings();
    const threshold = new Date();
    threshold.setUTCDate(threshold.getUTCDate() + Number(settings.warningDays));
    const limit = threshold.toISOString().slice(0, 10);
    const rows = await this.connection()
      .query.selectFrom('supplierQualifications as q')
      .innerJoin('suppliers as s', 's.id', 'q.supplierId')
      .select([
        'q.id',
        'q.supplierId',
        'q.typeCode',
        'q.validUntil',
        's.name as supplierName',
        's.status',
      ])
      .where('q.stage', '=', 'current')
      .where('q.validUntil', '<=', limit)
      .where('s.status', 'in', statuses)
      .orderBy('q.validUntil', 'asc')
      .limit(20)
      .offset((page - 1) * 20)
      .execute();
    return rows.map((row) => ({
      ...row,
      expiryState: String(row.validUntil) < today() ? 'expired' : 'expiring',
    }));
  }
}
