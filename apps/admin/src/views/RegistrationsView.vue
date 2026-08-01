<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { RegistrationStatus, WaitlistEntry } from '@conference/contracts';
import { useRoute } from 'vue-router';
import {
  conferenceApi,
  publicEventUrl,
  session,
  type AdminRegistrationDetail,
  type AdminRegistrationRow,
} from '../lib/api';
import { dateTime, money, statusClass, statusLabel } from '../lib/format';

const rows = ref<AdminRegistrationRow[]>([]);
const waitlist = ref<WaitlistEntry[]>([]);
const q = ref('');
const status = ref<RegistrationStatus | ''>('');
const loading = ref(false);
const exporting = ref(false);
const errorMessage = ref('');
const operationMessage = ref('');
const detailErrorMessage = ref('');
const canExport = session.can('event.registration.export');
const canReview = session.can('event.registration.manage');
const selected = ref<AdminRegistrationDetail>();
const selectedSummary = ref<AdminRegistrationRow>();
const selectedId = ref('');
const detailDialog = ref<HTMLDialogElement>();
const detailTrigger = ref<HTMLButtonElement>();
const detailLoading = ref(false);
const reviewReason = ref('');
const reviewPending = ref(false);
const page = ref(1);
const pageSize = ref(10);
const pageSizeDraft = ref('10');
const jumpPageDraft = ref('1');
const totalRecords = ref(0);
let loadRequestId = 0;
let detailRequestId = 0;
const route = useRoute();
const registrationUrl = computed(() => publicEventUrl('/register'));
const detailSummary = computed(() => selected.value ?? selectedSummary.value);
const coreKeys = new Set(['name', 'mobile', 'email', 'company', 'title', 'city']);
const fieldLabels: Record<string, string> = {
  name: '姓名',
  mobile: '手机号码',
  email: '电子邮箱',
  company: '公司 / 机构',
  title: '职位',
  city: '所在城市',
};
const totalPages = computed(() => Math.max(1, Math.ceil(totalRecords.value / pageSize.value)));
const visibleRange = computed(() => {
  if (!totalRecords.value) return '0 条';
  const start = (page.value - 1) * pageSize.value + 1;
  const end = start + rows.value.length - 1;
  return `第 ${start}–${end} 条，共 ${totalRecords.value} 条`;
});
const paginationItems = computed<Array<number | 'ellipsis'>>(() => {
  if (totalPages.value <= 7) {
    return Array.from({ length: totalPages.value }, (_, index) => index + 1);
  }
  const anchors = [...new Set([1, page.value - 1, page.value, page.value + 1, totalPages.value])]
    .filter((item) => item >= 1 && item <= totalPages.value)
    .sort((left, right) => left - right);
  const items: Array<number | 'ellipsis'> = [];
  anchors.forEach((item, index) => {
    if (index > 0 && item - anchors[index - 1]! > 1) items.push('ellipsis');
    items.push(item);
  });
  return items;
});

function customAnswerSummary(row: AdminRegistrationRow) {
  return Object.entries(row.formAnswers ?? {})
    .filter(([key, value]) => !coreKeys.has(key) && value)
    .map(([key, value]) => `${key}：${value}`)
    .join(' · ');
}

function answerEntries(row: AdminRegistrationDetail) {
  return Object.entries(row.formAnswers ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => ({
      key,
      label: fieldLabels[key] ?? key,
      value,
    }));
}

function paymentMethodLabel(value: string) {
  return (
    {
      wechat: '微信支付',
      alipay: '支付宝',
      bank: '银行转账',
      free: '免费票',
    }[value] ?? value
  );
}

function snapshotText(row: AdminRegistrationDetail, key: string) {
  const value = row.consentSnapshot?.[key];
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  return '';
}

function setPageState(nextPage: number) {
  page.value = Math.min(Math.max(Math.round(nextPage) || 1, 1), totalPages.value);
  jumpPageDraft.value = String(page.value);
}

function changePage(nextPage: number) {
  const previousPage = page.value;
  setPageState(nextPage);
  if (page.value !== previousPage) void load();
}

function commitPageSize() {
  const nextSize = Math.min(Math.max(Number.parseInt(pageSizeDraft.value, 10) || 10, 1), 100);
  if (nextSize === pageSize.value) {
    pageSizeDraft.value = String(nextSize);
    return;
  }
  pageSize.value = nextSize;
  pageSizeDraft.value = String(nextSize);
  void load(true);
}

function jumpToPage() {
  changePage(Number.parseInt(jumpPageDraft.value, 10));
}

async function openDetails(row: AdminRegistrationRow, event: MouseEvent) {
  const requestId = ++detailRequestId;
  selectedId.value = row.id;
  selectedSummary.value = row;
  selected.value = undefined;
  detailLoading.value = true;
  detailErrorMessage.value = '';
  operationMessage.value = '';
  detailTrigger.value = event.currentTarget as HTMLButtonElement;
  await nextTick();
  if (detailDialog.value && !detailDialog.value.open) detailDialog.value.showModal();
  try {
    const detail = await conferenceApi.getRegistration(row.id);
    if (requestId === detailRequestId && selectedId.value === row.id) selected.value = detail;
  } catch (error) {
    if (requestId === detailRequestId) {
      detailErrorMessage.value = error instanceof Error ? error.message : '报名详情读取失败';
    }
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false;
  }
}

async function closeDetails() {
  if (reviewPending.value) return;
  detailRequestId += 1;
  const trigger = detailTrigger.value;
  detailDialog.value?.close();
  selectedId.value = '';
  selectedSummary.value = undefined;
  selected.value = undefined;
  detailLoading.value = false;
  detailErrorMessage.value = '';
  reviewReason.value = '';
  operationMessage.value = '';
  await nextTick();
  trigger?.focus();
}

function closeDetailsFromBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) void closeDetails();
}

async function load(resetPage = false) {
  const requestId = ++loadRequestId;
  const requestedPage = resetPage ? 1 : page.value;
  loading.value = true;
  errorMessage.value = '';
  try {
    const [result, waiting] = await Promise.all([
      conferenceApi.getRegistrations({
        ...(q.value.trim() ? { q: q.value.trim() } : {}),
        ...(status.value ? { status: status.value } : {}),
        page: requestedPage,
        pageSize: pageSize.value,
      }),
      conferenceApi.getWaitlist(),
    ]);
    if (requestId !== loadRequestId) return;
    rows.value = result.items;
    waitlist.value = waiting;
    totalRecords.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
    pageSizeDraft.value = String(result.pageSize);
    jumpPageDraft.value = String(result.page);
  } catch (error) {
    if (requestId === loadRequestId) {
      errorMessage.value = error instanceof Error ? error.message : '报名数据读取失败';
    }
  } finally {
    if (requestId === loadRequestId) loading.value = false;
  }
}

async function exportData() {
  exporting.value = true;
  errorMessage.value = '';
  try {
    await conferenceApi.exportRegistrations();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '报名数据导出失败';
  } finally {
    exporting.value = false;
  }
}

async function review(decision: 'approve' | 'reject') {
  if (!selected.value || selected.value.status !== 'pending_review') return;
  if (decision === 'reject' && reviewReason.value.trim().length < 2) {
    errorMessage.value = '拒绝报名时请填写原因。';
    return;
  }
  const prompt =
    decision === 'approve'
      ? `确认通过 ${selected.value.attendee.name} 的报名审核？`
      : `确认拒绝 ${selected.value.attendee.name} 的报名审核？`;
  if (!window.confirm(prompt)) return;
  reviewPending.value = true;
  errorMessage.value = '';
  operationMessage.value = '';
  try {
    const result = await conferenceApi.reviewRegistration(selected.value.id, {
      decision,
      reason: reviewReason.value.trim(),
    });
    const updated: AdminRegistrationDetail = {
      ...selected.value,
      ...result.registration,
      order: result.order,
    };
    rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row));
    selected.value = updated;
    reviewReason.value = '';
    operationMessage.value =
      decision === 'approve'
        ? result.ticket
          ? '审核已通过，免费电子票已经签发。'
          : '审核已通过，参会人已获得 15 分钟支付窗口。'
        : '审核已拒绝，关联订单已关闭，库存已经释放。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '报名审核失败';
  } finally {
    reviewPending.value = false;
  }
}

watch(
  () => route.query.q,
  (query) => {
    q.value = String(query ?? '');
    void load(true);
  },
  { immediate: true },
);
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">ATTENDEE OPERATIONS</p>
      <h1>报名与参会人</h1>
      <p>按姓名、公司、手机号或报名码查询参会人。</p>
    </div>
    <div class="admin-head-actions">
      <button class="button secondary" type="button" @click="load()">刷新数据</button><button
        v-if="canExport"
        class="button secondary"
        type="button"
        :disabled="exporting"
        @click="exportData"
      >
        {{ exporting ? '正在导出…' : '导出 CSV' }}
      </button><a class="button" :href="registrationUrl" target="_blank" rel="noopener noreferrer">新增报名 ↗</a>
    </div>
  </header>

  <form class="admin-filter-bar" @submit.prevent="load(true)">
    <label class="admin-search"><span aria-hidden="true">⌕</span><input
      v-model="q"
      type="search"
      aria-label="搜索参会人"
      placeholder="搜索姓名、公司、手机号、报名码"
    /></label>
    <select v-model="status" class="admin-select" aria-label="按报名状态筛选" @change="load(true)">
      <option value="">全部状态</option>
      <option value="pending_review">待审核</option>
      <option value="pending_payment">待支付</option>
      <option value="confirmed">已确认</option>
      <option value="checked_in">已签到</option>
      <option value="cancelled">已取消</option>
    </select>
    <button class="button secondary" type="submit">查询</button>
    <button
      class="button"
      type="button"
      @click="
        q = '';
        status = '';
        load(true);
      "
    >
      重置
    </button>
  </form>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <p v-if="operationMessage" class="admin-success" role="status">{{ operationMessage }}</p>

  <section class="admin-panel reveal is-visible">
    <header class="admin-panel-header">
      <div>
        <h2>参会人名单</h2>
        <p>当前筛选共 {{ totalRecords }} 条记录</p>
      </div>
      <span class="status-badge">{{ loading ? 'LOADING' : `${totalRecords} RECORDS` }}</span>
    </header>
    <div class="data-table-wrap">
      <table class="data-table">
        <caption class="sr-only">
          参会人名单
        </caption>
        <thead>
          <tr>
            <th>参会人</th>
            <th>联系方式</th>
            <th>票种</th>
            <th>状态</th>
            <th>表单补充</th>
            <th>订单金额</th>
            <th>提交时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <span class="row-title">{{ row.attendee.name }}</span><span class="row-sub">{{ row.attendee.company }} · {{ row.attendee.title }}</span>
            </td>
            <td>
              <span>{{ row.attendee.mobile }}</span><span class="row-sub">{{ row.attendee.email }}</span>
            </td>
            <td>{{ row.ticketType.name }}</td>
            <td>
              <span class="status-badge" :class="statusClass(row.status)">{{
                statusLabel(row.status)
              }}</span>
            </td>
            <td>
              <span class="row-sub">{{ customAnswerSummary(row) || '无' }}</span>
            </td>
            <td>{{ row.order ? money(row.order.amount) : '未生成' }}</td>
            <td>{{ dateTime(row.createdAt) }}</td>
            <td>
              <div class="row-actions">
                <button
                  class="button secondary compact"
                  type="button"
                  @click="openDetails(row, $event)"
                >
                  查看
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !rows.length" class="admin-empty">当前筛选条件下没有报名记录。</div>
    </div>
    <footer class="table-footer registration-pagination">
      <span>{{ visibleRange }} · 时间均为 Asia/Shanghai</span>
      <nav class="registration-page-nav" aria-label="参会人名单分页">
        <button
          class="page-arrow"
          type="button"
          aria-label="上一页"
          :disabled="page === 1"
          @click="changePage(page - 1)"
        >
          ‹
        </button>
        <template v-for="(item, index) in paginationItems" :key="`${item}-${index}`">
          <span v-if="item === 'ellipsis'" class="page-ellipsis" aria-hidden="true">…</span>
          <button
            v-else
            class="page-number"
            :class="{ active: item === page }"
            type="button"
            :aria-current="item === page ? 'page' : undefined"
            :aria-label="`第 ${item} 页`"
            @click="changePage(item)"
          >
            {{ item }}
          </button>
        </template>
        <button
          class="page-arrow"
          type="button"
          aria-label="下一页"
          :disabled="page === totalPages"
          @click="changePage(page + 1)"
        >
          ›
        </button>
      </nav>
      <div class="registration-page-inputs">
        <label>
          <span>每页</span>
          <input
            v-model="pageSizeDraft"
            type="number"
            inputmode="numeric"
            min="1"
            max="100"
            aria-label="每页显示条数"
            @change="commitPageSize"
            @keydown.enter.prevent="commitPageSize"
          />
          <span>条</span>
        </label>
        <label>
          <span>跳至</span>
          <input
            v-model="jumpPageDraft"
            type="number"
            inputmode="numeric"
            min="1"
            :max="totalPages"
            aria-label="跳转页码"
            @change="jumpToPage"
            @keydown.enter.prevent="jumpToPage"
          />
          <span>页</span>
        </label>
      </div>
    </footer>
  </section>

  <dialog
    v-if="selectedId"
    ref="detailDialog"
    class="registration-detail-dialog"
    aria-labelledby="registration-detail-title"
    aria-describedby="registration-detail-description"
    @cancel.prevent="closeDetails"
    @click="closeDetailsFromBackdrop"
  >
    <header>
      <div>
        <p class="eyebrow">REGISTRATION DETAIL</p>
        <h2 id="registration-detail-title">
          {{ detailSummary?.attendee.name ?? '报名' }}的报名详情
        </h2>
        <p id="registration-detail-description">
          {{ detailSummary?.registrationCode ?? '正在读取报名信息' }}
          <template v-if="detailSummary">
            · 提交于 {{ dateTime(detailSummary.createdAt) }}
          </template>
        </p>
      </div>
      <button
        class="registration-detail-close"
        type="button"
        aria-label="关闭报名详情"
        title="关闭"
        :disabled="reviewPending"
        @click="closeDetails"
      >
        <span aria-hidden="true">×</span>关闭
      </button>
    </header>

    <div class="registration-detail-scroll">
      <div v-if="detailLoading" class="registration-detail-state">
        <div class="admin-loading">正在读取完整报名信息…</div>
      </div>
      <div v-else-if="detailErrorMessage" class="registration-detail-state">
        <p class="admin-error" role="alert">{{ detailErrorMessage }}</p>
      </div>
      <template v-else-if="selected">
        <p v-if="operationMessage" class="admin-success" role="status">{{ operationMessage }}</p>
        <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>

        <section class="registration-detail-summary" aria-label="报名概览">
          <div>
            <span>参会人</span>
            <strong>{{ selected.attendee.name }}</strong>
            <small>{{ selected.attendee.company }} · {{ selected.attendee.title }}</small>
          </div>
          <div>
            <span>报名状态</span>
            <strong>
              <i class="status-badge" :class="statusClass(selected.status)">{{
                statusLabel(selected.status)
              }}</i>
            </strong>
            <small>{{ selected.ticketType.name }}</small>
          </div>
          <div>
            <span>订单金额</span>
            <strong>{{ selected.order ? money(selected.order.amount) : '未生成' }}</strong>
            <small>{{
              selected.order ? statusLabel(selected.order.status) : '暂无关联订单'
            }}</small>
          </div>
        </section>

        <div class="registration-detail-layout">
          <section class="registration-detail-section">
            <header>
              <div>
                <p class="eyebrow">ATTENDEE</p>
                <h3>参会人信息</h3>
              </div>
              <span>{{ selected.attendee.city || '城市待补充' }}</span>
            </header>
            <dl class="registration-detail-list">
              <div>
                <dt>真实姓名</dt>
                <dd>{{ selected.attendee.name }}</dd>
              </div>
              <div>
                <dt>手机号码</dt>
                <dd>{{ selected.attendee.mobile }}</dd>
              </div>
              <div>
                <dt>电子邮箱</dt>
                <dd>{{ selected.attendee.email || '待补充' }}</dd>
              </div>
              <div>
                <dt>公司 / 机构</dt>
                <dd>{{ selected.attendee.company || '待补充' }}</dd>
              </div>
              <div>
                <dt>职位</dt>
                <dd>{{ selected.attendee.title || '待补充' }}</dd>
              </div>
              <div>
                <dt>所在城市</dt>
                <dd>{{ selected.attendee.city || '待补充' }}</dd>
              </div>
            </dl>
          </section>

          <section class="registration-detail-section">
            <header>
              <div>
                <p class="eyebrow">REGISTRATION</p>
                <h3>报名信息</h3>
              </div>
              <span>表单 V{{ selected.formVersion ?? 1 }}</span>
            </header>
            <dl class="registration-detail-list">
              <div>
                <dt>报名码</dt>
                <dd class="mono-code">{{ selected.registrationCode }}</dd>
              </div>
              <div>
                <dt>票种</dt>
                <dd>{{ selected.ticketType.name }}</dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{{ statusLabel(selected.status) }}</dd>
              </div>
              <div>
                <dt>提交时间</dt>
                <dd>{{ dateTime(selected.createdAt) }}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{{ dateTime(selected.updatedAt) }}</dd>
              </div>
              <div>
                <dt>报名标识</dt>
                <dd class="mono-code">{{ selected.id }}</dd>
              </div>
            </dl>
          </section>

          <section
            v-if="selected.customerRelation === 'included' && selected.customer"
            class="registration-detail-section"
          >
            <header>
              <div>
                <p class="eyebrow">USER ACCOUNT</p>
                <h3>用户账号</h3>
              </div>
              <span>{{ statusLabel(selected.customer.status) }}</span>
            </header>
            <dl class="registration-detail-list">
              <div>
                <dt>账号姓名</dt>
                <dd>
                  {{
                    selected.customer.profile.realName ||
                      selected.customer.profile.nickname ||
                      '待补充'
                  }}
                </dd>
              </div>
              <div>
                <dt>登录手机号</dt>
                <dd>{{ selected.customer.mobile }}</dd>
              </div>
              <div>
                <dt>账号邮箱</dt>
                <dd>{{ selected.customer.profile.email || '待补充' }}</dd>
              </div>
              <div>
                <dt>账号公司</dt>
                <dd>{{ selected.customer.profile.company || '待补充' }}</dd>
              </div>
              <div>
                <dt>最近登录</dt>
                <dd>
                  {{
                    selected.customer.lastLoginAt ? dateTime(selected.customer.lastLoginAt) : '暂无'
                  }}
                </dd>
              </div>
              <div>
                <dt>账号标签</dt>
                <dd>{{ selected.customer.tags.join('、') || '无' }}</dd>
              </div>
              <div class="full">
                <dt>内部备注</dt>
                <dd>{{ selected.customer.internalNote || '无' }}</dd>
              </div>
              <div class="full">
                <dt>用户 ID</dt>
                <dd class="mono-code">{{ selected.customer.id }}</dd>
              </div>
            </dl>
          </section>

          <section
            v-else-if="selected.customerRelation === 'restricted'"
            class="registration-detail-section registration-account-empty"
          >
            <header>
              <div>
                <p class="eyebrow">USER ACCOUNT</p>
                <h3>用户账号</h3>
              </div>
              <span>权限受限</span>
            </header>
            <p>当前角色可以查看本场报名资料，用户账号资料需要用户管理查看权限。</p>
          </section>

          <section v-else class="registration-detail-section registration-account-empty">
            <header>
              <div>
                <p class="eyebrow">USER ACCOUNT</p>
                <h3>用户账号</h3>
              </div>
              <span>未关联</span>
            </header>
            <p>本次报名未绑定前台用户账号，参会人的完整联系资料已记录在报名信息中。</p>
          </section>

          <section class="registration-detail-section">
            <header>
              <div>
                <p class="eyebrow">FORM SNAPSHOT</p>
                <h3>报名表与授权</h3>
              </div>
              <span>条款 {{ selected.termsVersion || '未记录' }}</span>
            </header>
            <dl class="registration-detail-list">
              <template v-if="answerEntries(selected).length">
                <div v-for="answer in answerEntries(selected)" :key="answer.key">
                  <dt>{{ answer.label }}</dt>
                  <dd>{{ answer.value }}</dd>
                </div>
              </template>
              <div v-else class="full">
                <dt>表单补充</dt>
                <dd>无额外字段</dd>
              </div>
              <div>
                <dt>是否需要发票</dt>
                <dd>{{ selected.invoiceRequired ? '是' : '否' }}</dd>
              </div>
              <div>
                <dt>营销信息授权</dt>
                <dd>{{ selected.marketingConsent ? '已同意' : '未同意' }}</dd>
              </div>
              <div>
                <dt>条款同意</dt>
                <dd>{{ snapshotText(selected, 'termsAccepted') || '已记录' }}</dd>
              </div>
              <div>
                <dt>同意时间</dt>
                <dd>
                  {{
                    snapshotText(selected, 'acceptedAt')
                      ? dateTime(snapshotText(selected, 'acceptedAt'))
                      : '未记录'
                  }}
                </dd>
              </div>
            </dl>
            <details v-if="snapshotText(selected, 'termsContent')" class="registration-terms">
              <summary>查看报名时同意的条款快照</summary>
              <p>{{ snapshotText(selected, 'termsContent') }}</p>
            </details>
          </section>

          <section class="registration-detail-section">
            <header>
              <div>
                <p class="eyebrow">ORDER</p>
                <h3>关联订单</h3>
              </div>
              <span>{{ selected.order ? statusLabel(selected.order.status) : '未生成' }}</span>
            </header>
            <dl v-if="selected.order" class="registration-detail-list">
              <div>
                <dt>订单号</dt>
                <dd class="mono-code">{{ selected.order.orderNo }}</dd>
              </div>
              <div>
                <dt>订单状态</dt>
                <dd>{{ statusLabel(selected.order.status) }}</dd>
              </div>
              <div>
                <dt>订单金额</dt>
                <dd>{{ money(selected.order.amount) }}</dd>
              </div>
              <div>
                <dt>支付方式</dt>
                <dd>{{ paymentMethodLabel(selected.order.paymentMethod) }}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{{ dateTime(selected.order.createdAt) }}</dd>
              </div>
              <div>
                <dt>支付窗口截止</dt>
                <dd>{{ dateTime(selected.order.expiresAt) }}</dd>
              </div>
              <div class="full">
                <dt>订单标识</dt>
                <dd class="mono-code">{{ selected.order.id }}</dd>
              </div>
            </dl>
            <p v-else class="registration-detail-empty">当前报名没有关联订单。</p>
          </section>
        </div>

        <section
          v-if="selected.status === 'pending_review' && canReview"
          class="registration-review-section"
        >
          <div class="form-field full">
            <label for="registration-review-reason">审核备注 / 拒绝原因</label>
            <textarea
              id="registration-review-reason"
              v-model="reviewReason"
              rows="3"
              maxlength="500"
              placeholder="通过时可选；拒绝时必填"
            />
          </div>
          <div class="admin-head-actions">
            <button
              class="button secondary"
              type="button"
              :disabled="reviewPending"
              @click="review('reject')"
            >
              拒绝报名
            </button>
            <button
              class="button"
              type="button"
              :disabled="reviewPending"
              @click="review('approve')"
            >
              {{ reviewPending ? '正在处理…' : '通过审核' }}
            </button>
          </div>
        </section>
      </template>
    </div>
  </dialog>

  <section class="admin-panel reveal is-visible admin-panel-spaced">
    <header class="admin-panel-header">
      <div>
        <h2>候补名单</h2>
        <p>库存释放后按队列顺序发放两小时购买资格</p>
      </div>
      <span class="status-badge">{{ waitlist.length }} WAITING</span>
    </header>
    <div class="data-table-wrap">
      <table class="data-table">
        <caption class="sr-only">
          报名候补名单
        </caption>
        <thead>
          <tr>
            <th>队列</th>
            <th>申请人</th>
            <th>票种</th>
            <th>状态</th>
            <th>邀请有效期</th>
            <th>申请时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in waitlist" :key="entry.id">
            <td>
              <span class="mono-code">#{{ entry.position }}</span>
            </td>
            <td>
              <span class="row-title">{{ entry.name }}</span><span class="row-sub">{{ entry.email }}</span>
            </td>
            <td>{{ entry.ticketTypeName }}</td>
            <td>
              <span class="status-badge" :class="statusClass(entry.status)">{{
                statusLabel(entry.status)
              }}</span>
            </td>
            <td>{{ entry.expiresAt ? dateTime(entry.expiresAt) : '等待释放' }}</td>
            <td>{{ dateTime(entry.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !waitlist.length" class="admin-empty">当前大会没有候补申请。</div>
    </div>
  </section>
</template>

<style scoped>
.registration-pagination {
  min-height: 64px;
  flex-wrap: wrap;
}

.registration-page-nav,
.registration-page-inputs,
.registration-page-inputs label {
  display: flex;
  align-items: center;
}

.registration-page-nav {
  gap: 4px;
}

.registration-page-nav button {
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--muted);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
  font-family: var(--mono);
  font-size: 10px;
  transition:
    color 140ms var(--ease),
    background-color 140ms var(--ease),
    border-color 140ms var(--ease);
}

.registration-page-nav button:hover:not(:disabled) {
  color: var(--blue);
  background: var(--blue-soft);
  border-color: color-mix(in srgb, var(--blue) 28%, var(--line));
}

.registration-page-nav button.active {
  color: #fff;
  background: var(--blue);
  border-color: var(--blue);
}

.registration-page-nav button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.page-ellipsis {
  width: 20px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  text-align: center;
}

.registration-page-inputs {
  gap: 12px;
}

.registration-page-inputs label {
  gap: 5px;
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
}

.registration-page-inputs input {
  width: 50px;
  height: 32px;
  padding: 0 6px;
  color: var(--ink);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
  font-family: var(--mono);
  font-size: 10px;
  text-align: center;
}

.registration-page-inputs input:focus,
.registration-page-nav button:focus-visible {
  border-color: var(--blue);
  outline: 2px solid color-mix(in srgb, var(--blue) 18%, transparent);
  outline-offset: 1px;
}

:global(.admin-body:has(.registration-detail-dialog[open])) {
  overflow: hidden;
}

.registration-detail-dialog {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(980px, calc(100vw - 40px));
  max-width: none;
  height: min(820px, calc(100dvh - 40px));
  max-height: none;
  margin: auto;
  padding: 0;
  overflow: hidden;
  color: var(--ink);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  box-shadow: 0 24px 70px rgb(23 34 51 / 24%);
  animation: registration-dialog-enter 160ms ease-out;
}

.registration-detail-dialog:not([open]) {
  display: none;
}

.registration-detail-dialog::backdrop {
  background: rgb(16 38 62 / 50%);
}

.registration-detail-dialog > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.registration-detail-dialog h2 {
  margin: 4px 0 0;
  font-family: var(--serif);
  font-size: 24px;
  font-weight: 500;
}

.registration-detail-dialog > header p:not(.eyebrow) {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 11px;
}

.registration-detail-close {
  min-width: 64px;
  height: 40px;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 600;
}

.registration-detail-close span {
  font-family: var(--mono);
  font-size: 16px;
  font-weight: 400;
}

.registration-detail-close:hover:not(:disabled) {
  color: var(--blue);
  background: var(--blue-soft);
  border-color: var(--line);
}

.registration-detail-scroll {
  overflow-y: auto;
  padding: 20px 24px 24px;
  background: var(--paper);
  overscroll-behavior: contain;
}

.registration-detail-scroll > .admin-success,
.registration-detail-scroll > .admin-error {
  margin-top: 0;
}

.registration-detail-state {
  min-height: 300px;
  display: grid;
  place-items: center;
}

.registration-detail-state .admin-error {
  width: min(520px, 100%);
}

.registration-detail-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
}

.registration-detail-summary > div {
  min-width: 0;
  padding: 16px 18px;
}

.registration-detail-summary > div + div {
  border-left: 1px solid var(--line);
}

.registration-detail-summary span,
.registration-detail-summary small {
  display: block;
  color: var(--muted);
  font-size: 10px;
}

.registration-detail-summary strong {
  display: block;
  min-height: 26px;
  margin: 5px 0 3px;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.registration-detail-summary strong .status-badge {
  display: inline-flex;
  width: fit-content;
  font-family: var(--mono);
  font-style: normal;
}

.registration-detail-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.registration-detail-section {
  min-width: 0;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
}

.registration-detail-section > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 16px 13px;
  border-bottom: 1px solid var(--line);
}

.registration-detail-section h3 {
  margin: 3px 0 0;
  color: var(--ink);
  font-family: var(--serif);
  font-size: 17px;
  font-weight: 600;
}

.registration-detail-section > header > span {
  flex: 0 0 auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
}

.registration-detail-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.registration-detail-list > div {
  min-width: 0;
  padding: 12px 16px;
  border-bottom: 1px solid rgb(23 34 51 / 7%);
}

.registration-detail-list > div:nth-child(odd):not(.full) {
  border-right: 1px solid rgb(23 34 51 / 7%);
}

.registration-detail-list > div:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.registration-detail-list > div.full {
  grid-column: 1 / -1;
  border-bottom: 1px solid rgb(23 34 51 / 7%);
}

.registration-detail-list > div.full:last-child {
  border-bottom: 0;
}

.registration-detail-list dt {
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 10px;
}

.registration-detail-list dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.55;
}

.registration-detail-list dd.mono-code {
  color: #44515d;
  font-size: 10px;
  font-weight: 500;
}

.registration-account-empty > p,
.registration-detail-empty {
  margin: 0;
  padding: 28px 18px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
}

.registration-terms {
  margin: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}

.registration-terms summary {
  min-height: 40px;
  padding: 10px 0;
  color: var(--blue);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
}

.registration-terms p {
  margin: 10px 0 0;
  color: #44515d;
  font-size: 10px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.registration-review-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: end;
  margin-top: 16px;
  padding: 18px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
}

@keyframes registration-dialog-enter {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 1040px) {
  .registration-pagination {
    justify-content: center;
  }

  .registration-pagination > span {
    width: 100%;
    text-align: center;
  }
}

@media (max-width: 700px) {
  .registration-detail-dialog {
    width: calc(100vw - 24px);
    height: calc(100dvh - 24px);
  }

  .registration-detail-dialog > header,
  .registration-detail-scroll {
    padding-right: 16px;
    padding-left: 16px;
  }

  .registration-detail-dialog h2 {
    font-size: 21px;
  }

  .registration-detail-summary,
  .registration-detail-layout {
    grid-template-columns: 1fr;
  }

  .registration-detail-summary > div + div {
    border-top: 1px solid var(--line);
    border-left: 0;
  }

  .registration-review-section {
    grid-template-columns: 1fr;
  }

  .registration-review-section .admin-head-actions {
    justify-content: stretch;
  }

  .registration-review-section .button {
    flex: 1;
  }
}

@media (max-width: 520px) {
  .registration-pagination {
    gap: 10px;
  }

  .registration-page-inputs {
    width: 100%;
    justify-content: center;
  }

  .registration-page-nav button {
    width: 40px;
    height: 40px;
  }

  .registration-page-inputs input {
    width: 56px;
    height: 40px;
  }

  .registration-detail-dialog > header {
    gap: 10px;
  }

  .registration-detail-list {
    grid-template-columns: 1fr;
  }

  .registration-detail-list > div,
  .registration-detail-list > div:nth-child(odd):not(.full),
  .registration-detail-list > div:nth-last-child(-n + 2) {
    grid-column: 1;
    border-right: 0;
    border-bottom: 1px solid rgb(23 34 51 / 7%);
  }

  .registration-detail-list > div:last-child {
    border-bottom: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .registration-detail-dialog {
    animation: none;
  }
}
</style>
