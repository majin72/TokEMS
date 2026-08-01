<script setup lang="ts">
import { DEMO_EVENT, type Order, type PublicEvent, type Ticket } from '@conference/contracts';
import QRCode from 'qrcode.vue';
import {
  activeFlowStep,
  enabledFlowSteps,
  resolveEventExperience,
} from '~/composables/useEventExperience';
import { useCustomerSession } from '~/composables/useCustomerSession';

const route = useRoute();
const router = useRouter();
const api = useConferenceApi();
const customer = useCustomerSession();
const checkout = ref<ReturnType<typeof api.readCheckout>>();
const order = ref<Order>();
const event = ref<PublicEvent>(api.readEvent() ?? structuredClone(DEMO_EVENT));
const pending = ref(false);
const paymentPreparing = ref(false);
const errorMessage = ref('');
const remainingSeconds = ref(15 * 60);
const orderAccessToken = ref('');
const issuedTicket = ref<Ticket>();
const claimPending = ref(false);
const claimMessage = ref('');
const localSimulation = import.meta.dev;
let countdown: ReturnType<typeof setInterval> | undefined;
let paymentPolling: ReturnType<typeof setInterval> | undefined;

const money = (amount: number) => `¥${(amount / 100).toLocaleString('zh-CN')}`;
function syncRemainingSeconds() {
  remainingSeconds.value = order.value
    ? Math.max(0, Math.floor((new Date(order.value.expiresAt).getTime() - Date.now()) / 1_000))
    : 0;
}
function ensureCountdown() {
  syncRemainingSeconds();
  if (!countdown) countdown = setInterval(syncRemainingSeconds, 1_000);
}
const remainingText = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60);
  const seconds = remainingSeconds.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});
const isFreeOrder = computed(
  () => order.value?.amount === 0 || order.value?.paymentMethod === 'free',
);
const awaitingReview = computed(
  () =>
    order.value?.status === 'pending_review' ||
    checkout.value?.registration.status === 'pending_review',
);
const canPay = computed(
  () =>
    Boolean(
      order.value &&
      !isFreeOrder.value &&
      ['pending_payment', 'processing'].includes(order.value.status),
    ) && remainingSeconds.value > 0,
);
const stateTitle = computed(() => {
  if (awaitingReview.value) return '报名已提交，等待大会审核';
  if (isFreeOrder.value && order.value?.status === 'paid') return '报名已确认，电子票已签发';
  if (order.value?.status === 'paid') return '订单已支付，电子票已签发';
  if (order.value?.status === 'partially_refunded') return '订单已完成部分退款';
  if (order.value?.status === 'refunded') return '订单已完成退款';
  if (order.value?.status === 'closed') return '订单已关闭';
  return '报名已提交，请完成支付';
});
const stateLead = computed(() => {
  if (awaitingReview.value)
    return '运营人员将在后台核对报名信息。审核结果会发送到报名邮箱，通过后即可继续支付或领取免费电子票。';
  if (isFreeOrder.value && order.value?.status === 'paid')
    return '免费报名已经完成，可随时打开电子票并在现场出示二维码签到。';
  if (order.value?.status === 'paid') return '可随时打开电子票，并在现场出示二维码完成签到。';
  if (order.value?.status === 'partially_refunded')
    return '退款进度已同步，剩余有效金额与票务状态以订单记录为准。';
  if (order.value?.status === 'refunded') return '对应电子票已取消，如有疑问请联系大会运营方。';
  if (order.value?.status === 'closed') return '席位保留已结束，请返回报名页重新提交。';
  return '席位已为你临时保留。支付成功后，系统会签发唯一电子票。';
});
const statusLabel = computed(() => {
  if (isFreeOrder.value && order.value?.status === 'paid') return '已确认';
  return {
    pending_review: '待审核',
    pending_payment: '待支付',
    processing: '支付处理中',
    paid: '已支付',
    partially_refunded: '部分退款',
    refunded: '已退款',
    closed: '已关闭',
  }[order.value?.status ?? 'pending_payment'];
});
const paymentMethodLabel = computed(
  () =>
    ({
      wechat: '微信支付',
      alipay: '支付宝',
      bank: '银行转账',
      free: '免费报名',
    })[order.value?.paymentMethod ?? 'wechat'],
);
const ticketHref = computed(() =>
  issuedTicket.value || checkout.value?.ticket
    ? `/ticket/${encodeURIComponent((issuedTicket.value ?? checkout.value!.ticket!).code)}?event=${encodeURIComponent(event.value.slug)}`
    : '/',
);
const registerHref = computed(() => `/register?event=${encodeURIComponent(event.value.slug)}`);
const flowSteps = computed(() =>
  enabledFlowSteps(event.value, {
    paymentRequired: !isFreeOrder.value,
    invoiceRequired: Boolean(checkout.value?.registration && api.readInvoiceAccess()),
  }),
);
const activeStep = computed(() =>
  activeFlowStep(
    flowSteps.value,
    isFreeOrder.value && order.value?.status === 'paid' ? 'success-ticket' : 'review-payment',
  ),
);
useHead(() => ({
  title: `${isFreeOrder.value ? '报名确认' : '确认订单'} · ${event.value.name}`,
}));

onMounted(async () => {
  try {
    checkout.value = api.readCheckout();
    issuedTicket.value = checkout.value?.ticket;
    await customer.refresh().catch(() => null);
    const currentUrl = new URL(window.location.href);
    const eventSlug = currentUrl.searchParams.get('event') ?? '';
    if (eventSlug) event.value = await api.getEvent(eventSlug);
    const fragmentAccess = new URLSearchParams(currentUrl.hash.slice(1)).get('access') ?? '';
    const accessToken =
      fragmentAccess || String(route.query.access ?? '') || checkout.value?.orderAccessToken;
    if (fragmentAccess || route.query.access) {
      currentUrl.searchParams.delete('access');
      currentUrl.hash = '';
      window.history.replaceState(
        {},
        '',
        `${currentUrl.pathname}${currentUrl.searchParams.size ? `?${currentUrl.searchParams}` : ''}`,
      );
    }
    orderAccessToken.value = accessToken ?? '';
    order.value = await api.getOrder(String(route.params.id), orderAccessToken.value);
    if (
      orderAccessToken.value &&
      ['paid', 'partially_refunded'].includes(order.value?.status ?? '')
    ) {
      issuedTicket.value = await api
        .getOrderTicket(order.value!.id, orderAccessToken.value)
        .catch(() => undefined);
    }
    if (order.value?.status === 'pending_payment') {
      await preparePayment();
      paymentPolling = setInterval(() => void refreshOrder(), 3_000);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '订单读取失败，请稍后重试。';
  }
  if (
    order.value &&
    !isFreeOrder.value &&
    ['pending_payment', 'processing'].includes(order.value.status)
  ) {
    ensureCountdown();
  }
});

onBeforeUnmount(() => {
  if (countdown) clearInterval(countdown);
  if (paymentPolling) clearInterval(paymentPolling);
});

async function preparePayment() {
  if (!order.value || !orderAccessToken.value || order.value.paymentUrl) return;
  paymentPreparing.value = true;
  errorMessage.value = '';
  try {
    const payment = await api.prepareWeChatNativePayment(order.value.id, orderAccessToken.value);
    order.value = { ...order.value, paymentUrl: payment.codeUrl };
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '微信支付二维码生成失败，请稍后重试。';
  } finally {
    paymentPreparing.value = false;
  }
}

async function refreshOrder() {
  if (!order.value || !orderAccessToken.value) return;
  try {
    const latest = await api.getOrder(order.value.id, orderAccessToken.value);
    if (!latest) return;
    order.value = latest;
    syncRemainingSeconds();
    if (['pending_payment', 'processing'].includes(latest.status) && !latest.paymentUrl) {
      await preparePayment();
    }
    if (latest.status === 'paid') {
      if (paymentPolling) clearInterval(paymentPolling);
      paymentPolling = undefined;
      const ticket = await api.getOrderTicket(latest.id, orderAccessToken.value);
      if (ticket) api.saveTicket(ticket);
      issuedTicket.value = ticket;
    }
  } catch {
    // 轮询失败时保留二维码，用户仍可手动刷新订单状态。
  }
}

async function claimRegistration() {
  if (!order.value || !orderAccessToken.value) return;
  if (!customer.session.value) {
    customer.openLogin();
    return;
  }
  claimPending.value = true;
  claimMessage.value = '';
  try {
    await customer.claimRegistration(order.value.id, orderAccessToken.value);
    claimMessage.value = '这条报名已保存到用户中心';
  } catch (error) {
    const value = error as { data?: { message?: string } };
    errorMessage.value = value.data?.message ?? '报名记录保存失败';
  } finally {
    claimPending.value = false;
  }
}

async function retryOrder() {
  if (!orderAccessToken.value) return;
  errorMessage.value = '';
  try {
    const latest = await api.getOrder(String(route.params.id), orderAccessToken.value);
    if (!latest) throw new Error('订单不存在或访问链接已经失效');
    order.value = latest;
    ensureCountdown();
    if (latest.status === 'pending_payment') {
      await preparePayment();
      if (!paymentPolling) {
        paymentPolling = setInterval(() => void refreshOrder(), 3_000);
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '订单读取失败，请稍后重试。';
  }
}

async function confirmPaymentSimulation() {
  if (!order.value) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const result = await api.confirmPayment(order.value, order.value.registrationId);
    api.saveTicket(result.ticket);
    if (result.invoice) {
      api.saveInvoiceAccess(result.invoice);
      await router.push({
        path: `/invoice/${result.invoice.id}`,
        query: { event: event.value.slug },
      });
      return;
    }
    await router.push({
      path: `/ticket/${result.ticket.code}`,
      query: { event: event.value.slug },
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '支付确认失败，请稍后重试。';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="flow-page">
    <FlowHeader />
    <main class="flow-shell" id="main-content">
      <div class="state-panel">
        <div class="state-icon" aria-hidden="true">
          {{ order?.status === 'closed' ? '!' : awaitingReview ? '…' : '✓' }}
        </div>
        <p class="flow-eyebrow" style="justify-content: center">
          {{ isFreeOrder ? 'REGISTRATION' : 'ORDER' }} / {{ statusLabel }}
        </p>
        <h1>{{ stateTitle }}</h1>
        <p>{{ stateLead }}</p>
      </div>
      <FlowStepper
        :active="activeStep"
        :payment-required="!isFreeOrder"
        :steps="flowSteps.map((step) => step.title)"
        :variant="resolveEventExperience(event).registrationFlow.progressVariant"
      />

      <div v-if="order" class="flow-card order-card">
        <section class="order-details">
          <h2>{{ isFreeOrder ? '报名明细' : '订单明细' }}</h2>
          <div class="summary-row">
            <span>订单编号</span><strong>{{ order.orderNo }}</strong>
          </div>
          <div class="summary-row">
            <span>大会</span><strong>{{ event.name }}</strong>
          </div>
          <div class="summary-row">
            <span>参会人</span><strong>{{ checkout?.registration.attendee.name ?? '待查询' }}</strong>
          </div>
          <div class="summary-row">
            <span>公司 / 组织</span><strong>{{ checkout?.registration.attendee.company ?? '待查询' }}</strong>
          </div>
          <div class="summary-row">
            <span>票种</span><strong>{{ checkout?.registration.ticketType.name ?? '大会门票' }}</strong>
          </div>
          <div class="summary-row">
            <span>{{ isFreeOrder ? '报名方式' : '支付方式' }}</span>
            <strong>{{ paymentMethodLabel }}</strong>
          </div>
          <div class="summary-row is-total">
            <span>{{ isFreeOrder ? '报名费用' : '应付金额' }}</span>
            <strong>{{ isFreeOrder ? '免费' : money(order.amount) }}</strong>
          </div>
          <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
          <div v-if="orderAccessToken" class="order-account-link">
            <p v-if="claimMessage" class="form-success" role="status">{{ claimMessage }}</p>
            <button
              class="flow-action is-secondary"
              type="button"
              :disabled="claimPending"
              @click="claimRegistration"
            >
              {{
                customer.session.value
                  ? claimPending
                    ? '正在保存…'
                    : '保存到用户中心'
                  : '登录并保存到用户中心'
              }}
            </button>
          </div>
        </section>
        <aside class="order-payment">
          <template v-if="awaitingReview">
            <div class="payment-placeholder" aria-label="报名等待审核">REVIEW</div>
            <p>审核期间无需付款，请留意报名邮箱中的结果通知。</p>
            <NuxtLink class="flow-action is-secondary is-full" to="/">返回大会首页</NuxtLink>
          </template>
          <template v-else-if="isFreeOrder && order.status === 'paid'">
            <div class="payment-placeholder is-confirmed" aria-label="免费报名已确认">FREE</div>
            <p>席位已确认，电子票可立即用于现场签到。</p>
            <NuxtLink class="flow-action is-full" :to="ticketHref">查看电子票</NuxtLink>
          </template>
          <template v-else-if="order.status === 'pending_payment' || order.status === 'processing'">
            <div v-if="paymentPreparing" class="payment-placeholder" aria-label="正在生成支付码">
              …
            </div>
            <QRCode
              v-else-if="order.paymentUrl"
              class="payment-qr"
              :value="order.paymentUrl"
              :size="144"
              level="M"
              render-as="svg"
              aria-label="微信支付二维码"
            />
            <div v-else class="payment-placeholder" aria-label="支付码暂不可用">PAY</div>
            <button
              v-if="!order.paymentUrl && !paymentPreparing"
              class="flow-action is-secondary is-full"
              type="button"
              :disabled="!canPay"
              @click="preparePayment"
            >
              重新生成支付码
            </button>
            <p>
              请在
              <strong style="color: var(--conference-red)">{{ remainingText }}</strong> 内完成支付
            </p>
            <button
              class="flow-action is-full"
              type="button"
              :disabled="paymentPreparing || !canPay"
              @click="refreshOrder"
            >
              我已完成支付
            </button>
            <button
              v-if="localSimulation"
              class="flow-action is-secondary is-full"
              type="button"
              :disabled="pending || !canPay"
              style="margin-top: 8px"
              @click="confirmPaymentSimulation"
            >
              {{ pending ? '正在确认…' : '开发环境模拟支付' }}
            </button>
            <NuxtLink
              class="flow-action is-secondary is-full"
              :to="registerHref"
              style="margin-top: 8px"
            >
              返回修改信息
            </NuxtLink>
          </template>
          <template v-else-if="['paid', 'partially_refunded'].includes(order.status)">
            <div class="payment-placeholder" aria-label="订单已支付">OK</div>
            <p>{{ statusLabel }}，电子票状态将从服务端实时读取。</p>
            <NuxtLink class="flow-action is-full" :to="ticketHref">查看电子票</NuxtLink>
          </template>
          <template v-else>
            <div class="payment-placeholder" aria-label="订单已结束">END</div>
            <p>{{ stateLead }}</p>
            <NuxtLink class="flow-action is-secondary is-full" :to="registerHref">
              重新报名
            </NuxtLink>
          </template>
        </aside>
      </div>

      <div v-else class="flow-card flow-card__body" style="text-align: center">
        <template v-if="errorMessage">
          <p class="form-error" role="alert">{{ errorMessage }}</p>
          <button class="flow-action" type="button" @click="retryOrder">重新读取订单</button>
        </template>
        <p v-else>正在读取订单…</p>
      </div>
    </main>
  </div>
</template>
