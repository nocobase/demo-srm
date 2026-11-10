export type SupplierStatus =
  | 'draft'
  | 'pending'
  | 'returned'
  | 'approved'
  | 'renewalPending'
  | 'renewalReturned';
/** Supplier categories; each one owns an independent set of admission rules. */
export const supplierCategories = [
  'equipment',
  'service',
  'both',
  'testing',
] as const;
export type SupplierCategory = (typeof supplierCategories)[number];
export interface SupplierFile {
  id: string;
  filename: string;
  ext: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
}
export interface Qualification {
  id: string;
  typeCode: string;
  certificateNumber?: string;
  validUntil: string | null;
  fileId: string;
  stage: 'current' | 'proposed' | 'archived';
  file: SupplierFile | null;
}
export interface ReviewEvent {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  note?: string | null;
  actorId: string;
  createdAt: string;
}
export interface Supplier {
  id: string;
  version: number;
  ownerId: string;
  canReview?: boolean;
  name: string;
  creditCode: string;
  category: SupplierCategory;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address?: string;
  notes?: string;
  status: SupplierStatus;
  expiryState?: 'valid' | 'expiring' | 'expired';
  reviewNote?: string | null;
  updatedAt: string;
  qualifications: Qualification[];
  events: ReviewEvent[];
  submissions: SubmissionSnapshot[];
}
export interface ReviewBrief {
  supplier: Pick<
    Supplier,
    'id' | 'name' | 'creditCode' | 'category' | 'status' | 'version'
  >;
  snapshot: {
    id: string;
    source: string;
    submittedAt: string;
    requirements: SubmissionSnapshot['requirements'];
  };
  checkedAt: string;
  warningDays: number;
  findings: (AdmissionResult & {
    severity: 'blocking' | 'warning' | 'info';
    qualificationId: string | null;
    file: SupplierFile | null;
    evidence: {
      snapshotId: string;
      submittedAt: string;
      qualificationId: string | null;
      fileId: string | null;
    };
    contentVerified: boolean;
  })[];
  previousReturn: {
    id: string;
    note: string | null;
    createdAt: string;
    previousSnapshotId: string | null;
  } | null;
  changes: {
    typeCode: string;
    name: string;
    previousStatus: AdmissionResult['status'] | null;
    currentStatus: AdmissionResult['status'];
    changed: boolean;
    outcome: 'unresolved' | 'supplemented' | 'uncertain';
    previousSnapshotId: string | null;
  }[];
}
export interface AdmissionRule {
  id?: string;
  category: SupplierCategory;
  typeCode: string;
  name: string;
  required: boolean;
  checkValidity: boolean;
  enabled: boolean;
}
export interface AdmissionResult {
  typeCode: string;
  name: string;
  required: boolean;
  checkValidity: boolean;
  fileId: string | null;
  validUntil: string | null;
  status: 'complete' | 'missing' | 'expired' | 'dateMissing' | 'notProvided';
}
export interface SubmissionSnapshot {
  id: string;
  source: 'submission' | 'migration-baseline';
  category: string;
  submittedAt: string;
  requirements: Omit<AdmissionResult, 'fileId' | 'validUntil' | 'status'>[];
  results: AdmissionResult[];
}
export interface QualificationType {
  code: string;
  name: string;
  category: string;
  required: boolean;
  enabled: boolean;
}
export interface SupplierMyResponse {
  data: {
    supplier: Supplier | null;
    types: QualificationType[];
    rules: AdmissionRule[];
    reviewer: boolean;
  };
}
export interface SupplierResponse {
  data: Supplier;
}
