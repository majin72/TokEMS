<script setup lang="ts">
import type { PartnerRelationshipView, PartnerVisibleFields } from '@conference/contracts';
import QRCode from 'qrcode.vue';
import { watch } from 'vue';
import { useCustomerSession } from '~/composables/useCustomerSession';
import { copyPlainText } from '~/utils/copy-text';

type Tab = 'profile' | 'promotion' | 'earnings' | 'payouts' | 'inquiries';
type FinanceRow = Record<string, unknown> & { id?: string; status?: string; version?: number };

const route = useRoute();
const customer = useCustomerSession();
const eventId = computed(() => Number(route.params.eventId));
const partner = ref<PartnerRelationshipView | null>(null);
const commissions = ref<FinanceRow[]>([]);
const payouts = ref<FinanceRow[]>([]);
const recipients = ref<FinanceRow[]>([]);
const payoutDocuments = ref<FinanceRow[]>([]);
const activeTab = ref<Tab>('profile');
const loading = ref(true);
const pending = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const pendingAvatarAssetId = ref<string | undefined>();
const avatarPreview = ref('');
const profileForm = reactive({
  displayName: '', company: '', title: '', industry: '', businessIntro: '', businessUrl: '',
  contactPhone: '', contactEmail: '', wechatId: '',
});
const visibility = reactive<PartnerVisibleFields>({
  avatar: true, displayName: true, company: true, title: true, industry: true,
  businessIntro: true, businessUrl: false, contactPhone: false, contactEmail: false,
  wechatId: false, gallery: false,
});
const posterVisibility = reactive<PartnerVisibleFields>({
  avatar: true, displayName: true, company: true, title: true, industry: false,
  businessIntro: false, businessUrl: false, contactPhone: false, contactEmail: false,
  wechatId: false, gallery: false,
});
const privacyForm = reactive({ publicStatus: 'draft' as 'draft' | 'published' | 'hidden', searchIndexingEnabled: true });
const gallery = ref<Array<{ assetId: string; url: string; alt: string }>>([]);
const recipientForm = reactive({ type: 'individual', channel: 'wechat_transfer', displayName: '', accountReference: '' });
const payoutForm = reactive({ recipientId: '', amountYuan: '10' });
const inquiryForm = reactive({ type: 'missing_order', orderReference: '', description: '' });

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'profile', label: '资料与公开设置' },
  { id: 'promotion', label: '推广素材' },
  { id: 'earnings', label: '收益明细' },
  { id: 'payouts', label: '提现与结算' },
  { id: 'inquiries', label: '佣金申诉' },
];
const statusText: Record<string, string> = {
  pending_confirmation: '待确认合作规则', active: '合作中', paused: '已暂停', closed: '已关闭',
  provisional: '预计', pending: '结算等待中', available: '可提现', reserved: '提现处理中',
  paid: '已结算', recovery_due: '待追偿', submitted: '待审核', approved: '审核通过',
  under_review: '待确认结算金额',
  batched: '已组批', executing: '出款中', succeeded: '已到账', rejected: '已驳回',
  failed: '失败', unknown: '渠道待确认', verified: '已验证', hidden: '已隐藏', published: '已公开', draft: '草稿',
};
const visibleChoices: Array<{ key: keyof PartnerVisibleFields; label: string }> = [
  { key: 'avatar', label: '头像' }, { key: 'displayName', label: '姓名' },
  { key: 'company', label: '公司' }, { key: 'title', label: '职位' },
  { key: 'industry', label: '行业' }, { key: 'businessIntro', label: '介绍' },
  { key: 'businessUrl', label: '项目网址' }, { key: 'contactPhone', label: '联系电话' },
  { key: 'contactEmail', label: '联系邮箱' }, { key: 'wechatId', label: '微信号' },
  { key: 'gallery', label: '图片资料' },
];
const referralUrl = computed(() => {
  const path = partner.value?.referralPath ?? '';
  return import.meta.client && path ? new URL(path, window.location.origin).toString() : path;
});
const confirmed = computed(() =>
  Boolean(partner.value?.currentProgram?.id && partner.value.acceptedProgramVersionId === partner.value.currentProgram.id),
);
const verifiedRecipients = computed(() => recipients.value.filter((item) => item.status === 'verified'));
const posterIdentity = computed(() =>
  [
    posterVisibility.company ? profileForm.company : '',
    posterVisibility.title ? profileForm.title : '',
  ].filter(Boolean).join(' · '),
);
watch(
  () => recipientForm.type,
  (type) => {
    if (type === 'organization') recipientForm.channel = 'manual_bank';
  },
);

function money(value: unknown) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(value ?? 0) / 100);
}
function dateTime(value: unknown) {
  return typeof value === 'string' && value ? new Date(value).toLocaleString('zh-CN') : '暂无';
}
function hydrate(value: PartnerRelationshipView) {
  partner.value = value;
  Object.assign(profileForm, value.profile);
  Object.assign(visibility, value.profile.visibleFields);
  Object.assign(posterVisibility, value.profile.posterFields);
  privacyForm.publicStatus = value.profile.publicStatus;
  privacyForm.searchIndexingEnabled = value.profile.searchIndexingEnabled;
  gallery.value = value.profile.gallery.map((item) => ({ ...item }));
  avatarPreview.value = value.profile.avatarUrl ?? '';
  pendingAvatarAssetId.value = undefined;
}
async function refreshFinance() {
  const [commissionResult, payoutResult] = await Promise.all([
    customer.partnerCommissions(eventId.value), customer.partnerPayouts(eventId.value),
  ]);
  commissions.value = commissionResult.items;
  payouts.value = payoutResult.requests;
  recipients.value = payoutResult.recipients;
  payoutDocuments.value = payoutResult.documents;
  if (!payoutForm.recipientId && verifiedRecipients.value[0]?.id) payoutForm.recipientId = String(verifiedRecipients.value[0].id);
}
async function load() {
  loading.value = true; errorMessage.value = '';
  try {
    await customer.refresh();
    if (!customer.session.value) return customer.openLogin();
    hydrate(await customer.partnership(eventId.value));
    if (import.meta.client) {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const handoffCode = fragment.get('partner-recipient-handoff');
      if (handoffCode) {
        await customer.completePartnerWechatRecipientBinding(eventId.value, handoffCode);
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
        successMessage.value = '微信收款人已完成身份授权和绑定';
      }
    }
    await refreshFinance();
  } catch (error) {
    errorMessage.value = (error as { data?: { message?: string } }).data?.message ?? '合作伙伴中心暂时无法加载';
  } finally { loading.value = false; }
}
async function run(action: () => Promise<void>, message: string) {
  pending.value = true; errorMessage.value = ''; successMessage.value = '';
  try { await action(); successMessage.value = message; }
  catch (error) { errorMessage.value = (error as { data?: { message?: string }; message?: string }).data?.message ?? (error as Error).message ?? '操作失败，请稍后重试'; }
  finally { pending.value = false; }
}
function acceptRules() {
  const current = partner.value?.currentProgram;
  if (!partner.value || !current) return;
  return run(async () => hydrate(await customer.acceptPartnerProgram(eventId.value, { programVersionId: current.id, expectedPartnerVersion: partner.value!.version })), '合作规则已确认，专属推广链接已经生效');
}
function saveProfile() {
  if (!partner.value) return;
  return run(async () => {
    hydrate(await customer.updatePartnerProfile(eventId.value, {
      expectedVersion: partner.value!.version, ...profileForm,
      ...(pendingAvatarAssetId.value ? { avatarAssetId: pendingAvatarAssetId.value } : {}),
      gallery: gallery.value.map(({ assetId, alt }) => ({ assetId, alt })),
    }));
  }, '合作伙伴资料已保存');
}
function savePrivacy() {
  if (!partner.value) return;
  return run(async () => hydrate(await customer.updatePartnerPrivacy(eventId.value, {
    expectedVersion: partner.value!.version,
    publicStatus: privacyForm.publicStatus,
    visibleFields: { ...visibility },
    posterFields: { ...posterVisibility },
    searchIndexingEnabled: privacyForm.searchIndexingEnabled,
  })), '公开范围已更新');
}
async function uploadAvatar(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  await run(async () => {
    const uploaded = await customer.uploadPartnerMedia(eventId.value, 'avatar', file);
    pendingAvatarAssetId.value = uploaded.assetId;
    avatarPreview.value = URL.createObjectURL(file);
  }, '头像已上传，请保存资料');
}
async function uploadGallery(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file || gallery.value.length >= 4) return;
  await run(async () => {
    const uploaded = await customer.uploadPartnerMedia(eventId.value, 'gallery', file);
    gallery.value.push({ assetId: uploaded.assetId, url: URL.createObjectURL(file), alt: file.name.replace(/\.[^.]+$/u, '') });
  }, '图片已加入，请保存资料');
}
async function copyLink() {
  if (await copyPlainText(referralUrl.value)) successMessage.value = '推广链接已复制';
}
function downloadPoster() {
  if (!import.meta.client || !partner.value) return;
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1440;
  const context = canvas.getContext('2d'); if (!context) return;
  const gradient = context.createLinearGradient(0, 0, 1080, 1440); gradient.addColorStop(0, '#122f55'); gradient.addColorStop(.7, '#1f5fe8'); gradient.addColorStop(1, '#8bbaff');
  context.fillStyle = gradient; context.fillRect(0, 0, 1080, 1440); context.fillStyle = '#b9d4ff'; context.font = 'bold 34px sans-serif'; context.fillText('TOKEMS EVENT PARTNER', 90, 110);
  context.fillStyle = '#fff'; context.font = 'bold 92px sans-serif'; context.fillText(posterVisibility.displayName ? partner.value.profile.displayName : '大会合作伙伴', 90, 410);
  context.font = '40px sans-serif'; context.fillStyle = '#dceaff'; context.fillText(posterIdentity.value, 90, 475);
  context.font = 'bold 48px sans-serif'; context.fillStyle = '#fff'; context.fillText(partner.value.eventName, 90, 890);
  const svg = document.querySelector('.promotion-poster svg');
  const finish = () => { const link = document.createElement('a'); link.download = `${partner.value!.profile.displayName}-${partner.value!.eventName}-推广海报.png`; link.href = canvas.toDataURL('image/png'); link.click(); };
  if (!svg) return finish();
  const image = new Image(); image.onload = () => { context.fillStyle = '#fff'; context.fillRect(90, 1010, 270, 270); context.drawImage(image, 105, 1025, 240, 240); context.fillStyle = '#fff'; context.font = '32px sans-serif'; context.fillText('扫码通过我报名', 400, 1150); finish(); };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
}
function bindRecipient() {
  if (recipientForm.channel === 'wechat_transfer') {
    return run(async () => {
      const result = await customer.startPartnerWechatRecipientBinding(
        eventId.value,
        recipientForm.displayName,
      );
      window.location.assign(result.authorizeUrl);
    }, '正在进入微信身份授权');
  }
  return run(async () => { await customer.bindPartnerRecipient(eventId.value, { ...recipientForm, idempotencyKey: crypto.randomUUID() }); await refreshFinance(); }, '收款信息已提交，验证完成后可用于提现');
}
function requestPayout() {
  return run(async () => { await customer.createPartnerPayout(eventId.value, { amount: Math.round(Number(payoutForm.amountYuan) * 100), recipientId: payoutForm.recipientId, idempotencyKey: crypto.randomUUID() }); await refreshFinance(); if (partner.value) hydrate(await customer.partnership(eventId.value)); }, '提现申请已提交');
}
function confirmSettlement(request: FinanceRow) {
  if (!request.id || !request.version) return;
  return run(async () => {
    await customer.confirmPartnerPayoutSettlement(eventId.value, request.id!, request.version!);
    await refreshFinance();
  }, '结算金额已确认，提现进入待组批状态');
}
function submitInquiry() {
  return run(async () => { await customer.createPartnerInquiry(eventId.value, { ...inquiryForm, evidenceAssetIds: [] }); inquiryForm.orderReference = ''; inquiryForm.description = ''; }, '佣金申诉已提交');
}
async function confirmWechat(request: FinanceRow) {
  if (!request.id) return;
  await run(async () => {
    const payload = await customer.partnerPayoutConfirmation(eventId.value, request.id!);
    const bridge = (window as unknown as { WeixinJSBridge?: { invoke: (name: string, input: Record<string, string>, callback: (result: { err_msg?: string }) => void) => void } }).WeixinJSBridge;
    if (!bridge) throw new Error('请在微信中打开本页面完成确认');
    await new Promise<void>((resolve, reject) => bridge.invoke('requestMerchantTransfer', { mchId: payload.mchId, appId: payload.appId, package: payload.package }, (result) => result.err_msg?.includes(':ok') ? resolve() : reject(new Error('微信确认未完成'))));
    await customer.markPartnerPayoutConfirmed(eventId.value, request.id!, payload.requestVersion);
    await refreshFinance();
  }, '微信确认已提交，请等待到账结果');
}
function documentsForPayout(requestId: unknown) {
  return payoutDocuments.value.filter((item) => item.payoutRequestId === requestId);
}
function downloadPayoutDocument(document: FinanceRow) {
  if (!document.id) return;
  return run(
    () => customer.downloadPartnerPayoutDocument(eventId.value, document.id!),
    '结算文件下载已开始',
  );
}

onMounted(load);
watch(
  visibility,
  (current) => {
    for (const key of visibleChoices.map((item) => item.key)) {
      if (!current[key]) posterVisibility[key] = false;
    }
  },
  { deep: true },
);
useHead({ title: '合作伙伴中心' });
</script>

<template>
  <div class="partner-account-page">
    <FlowHeader />
    <main id="main-content" class="partner-account-shell">
      <p v-if="loading" class="page-state">正在加载合作伙伴中心...</p>
      <p v-else-if="!partner" class="page-state">{{ errorMessage || '当前大会尚未开通合作伙伴权限' }}</p>
      <template v-else>
        <NuxtLink class="back-link" to="/account">← 返回个人中心</NuxtLink>
        <header class="account-hero">
          <div><p>PARTNER CENTER</p><h1>{{ partner.eventName }}</h1><span>合作伙伴工作台</span></div>
          <div class="hero-balance"><small>可提现收益</small><strong>{{ money(partner.balances.available) }}</strong><em>{{ statusText[partner.qualificationStatus] }}</em></div>
        </header>
        <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>
        <div v-if="successMessage" class="notice success">{{ successMessage }}</div>
        <section v-if="!confirmed && partner.currentProgram" class="rules-card">
          <div><p>开始推广前请确认</p><h2>{{ partner.currentProgram.termsTitle }}</h2><div class="rules-copy">{{ partner.currentProgram.termsContent }}</div><small>{{ partner.currentProgram.promotionPolicy }}</small></div>
          <button :disabled="pending" @click="acceptRules">确认规则并开通推广</button>
        </section>
        <nav class="tab-nav" aria-label="合作伙伴中心模块"><button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">{{ tab.label }}</button></nav>

        <section v-if="activeTab === 'profile'" class="content-grid">
          <form class="panel" @submit.prevent="saveProfile">
            <div class="panel-title"><div><p>PROFILE</p><h2>合作伙伴资料</h2></div><button :disabled="pending">保存资料</button></div>
            <div class="avatar-editor"><div class="avatar"><img v-if="avatarPreview" :src="avatarPreview" alt="合作伙伴头像预览"><span v-else>{{ profileForm.displayName.slice(0,1) }}</span></div><label>上传头像<input type="file" accept="image/jpeg,image/png,image/webp" @change="uploadAvatar"></label></div>
            <div class="form-grid"><label>公开姓名<input v-model="profileForm.displayName" required maxlength="80"></label><label>公司<input v-model="profileForm.company" maxlength="160"></label><label>职位<input v-model="profileForm.title" maxlength="100"></label><label>行业<input v-model="profileForm.industry" maxlength="80"></label><label class="wide">个人或业务介绍<textarea v-model="profileForm.businessIntro" rows="6" maxlength="2000"></textarea></label><label class="wide">项目网址<input v-model="profileForm.businessUrl" type="url" placeholder="https://"></label><label>联系电话<input v-model="profileForm.contactPhone" maxlength="32"></label><label>联系邮箱<input v-model="profileForm.contactEmail" type="email"></label><label>微信号<input v-model="profileForm.wechatId" maxlength="80"></label></div>
            <div class="gallery-editor"><div class="section-row"><h3>图片资料</h3><label v-if="gallery.length < 4">添加图片<input type="file" accept="image/jpeg,image/png,image/webp" @change="uploadGallery"></label></div><div class="gallery-list"><div v-for="(item,index) in gallery" :key="item.assetId"><img :src="item.url" :alt="item.alt"><input v-model="item.alt" maxlength="120"><button type="button" @click="gallery.splice(index,1)">移除</button></div></div></div>
          </form>
          <form class="panel compact" @submit.prevent="savePrivacy"><div class="panel-title"><div><p>PRIVACY</p><h2>公开授权</h2></div><button :disabled="pending">保存设置</button></div><label>资料状态<select v-model="privacyForm.publicStatus"><option value="draft">草稿</option><option value="published">公开展示</option><option value="hidden">暂时隐藏</option></select></label><h3>详情页公开字段</h3><div class="toggle-list"><label v-for="item in visibleChoices" :key="`public-${item.key}`"><input v-model="visibility[item.key]" type="checkbox"><span>{{ item.label }}</span></label></div><h3>海报展示字段</h3><div class="toggle-list"><label v-for="item in visibleChoices" :key="`poster-${item.key}`"><input v-model="posterVisibility[item.key]" type="checkbox" :disabled="!visibility[item.key]"><span>{{ item.label }}</span></label></div><label class="switch-line"><input v-model="privacyForm.searchIndexingEnabled" type="checkbox">允许搜索引擎收录公开详情页</label><small>海报只能选择已经授权公开的字段；关闭详情页字段时，海报会同步关闭该字段。</small></form>
        </section>

        <section v-else-if="activeTab === 'promotion'" class="promotion-layout"><article class="panel"><div class="panel-title"><div><p>PROMOTION</p><h2>专属推广链接</h2></div></div><p class="hint">访客主动点击后建立来源，有效期 {{ partner.currentProgram?.attributionDays ?? 30 }} 天。</p><div class="link-box"><code>{{ referralUrl || '确认合作规则后生成' }}</code><button :disabled="!referralUrl" @click="copyLink">复制链接</button></div><div class="promotion-actions"><a v-if="referralUrl" :href="referralUrl" target="_blank">测试推广入口</a><NuxtLink :to="`/partners/${partner.publicSlug}?event=${partner.eventSlug}`">预览公开详情</NuxtLink><button :disabled="!referralUrl" @click="downloadPoster">下载海报</button></div></article><aside class="promotion-poster"><p>TOKEMS PARTNER</p><div><small>{{ posterVisibility.industry ? (partner.profile.industry || '大会合作伙伴') : '大会合作伙伴' }}</small><h2>{{ posterVisibility.displayName ? partner.profile.displayName : '大会合作伙伴' }}</h2><span v-if="posterIdentity">{{ posterIdentity }}</span></div><footer><strong>{{ partner.eventName }}</strong><div v-if="referralUrl"><QRCode :value="referralUrl" :size="116" level="M" render-as="svg" /><small>扫码通过我报名</small></div></footer></aside></section>

        <section v-else-if="activeTab === 'earnings'" class="panel"><div class="panel-title"><div><p>EARNINGS</p><h2>收益明细</h2></div><div class="balance-pills"><span>待结算 {{ money(partner.balances.pending) }}</span><span>已结算 {{ money(partner.balances.paid) }}</span></div></div><div class="data-list"><article v-for="item in commissions" :key="String(item.id)"><div><strong>订单 {{ String(item.orderId ?? '').slice(-8) }}</strong><small>{{ dateTime(item.createdAt) }}</small></div><div><b>{{ money(item.commissionAmount) }}</b><em>{{ statusText[String(item.status)] ?? item.status }}</em></div></article><p v-if="!commissions.length" class="empty">暂无佣金记录</p></div></section>

        <section v-else-if="activeTab === 'payouts'" class="content-grid">
          <article class="panel">
            <div class="panel-title"><div><p>PAYOUT</p><h2>申请提现</h2></div></div>
            <form class="stack-form" @submit.prevent="requestPayout">
              <label>已验证收款人<select v-model="payoutForm.recipientId" required><option value="">请选择</option><option v-for="item in verifiedRecipients" :key="String(item.id)" :value="String(item.id)">{{ item.channel === 'wechat_transfer' ? '微信商家转账' : '人工对公结算' }}</option></select></label>
              <label>税前提现金额<input v-model="payoutForm.amountYuan" type="number" min="10" step="0.01" required></label>
              <button :disabled="pending || !payoutForm.recipientId">提交提现申请</button>
            </form>
            <div class="data-list">
              <article v-for="item in payouts" :key="String(item.id)">
                <div>
                  <strong>{{ money(item.grossAmount) }}</strong>
                  <small v-if="Number(item.taxAmount ?? 0) > 0">代扣税费 {{ money(item.taxAmount) }}，预计到账 {{ money(item.netAmount) }}</small>
                  <small>{{ dateTime(item.createdAt) }}</small>
                  <span class="document-links"><button v-for="document in documentsForPayout(item.id)" :key="String(document.id)" type="button" @click="downloadPayoutDocument(document)">{{ document.kind === 'manual_receipt' ? '下载结算回单' : document.kind === 'wechat_receipt' ? '下载微信回单' : document.kind === 'tax_document' ? '下载税务材料' : '下载结算单' }}</button></span>
                </div>
                <div><em>{{ statusText[String(item.status)] ?? item.status }}</em><button v-if="item.status === 'under_review'" @click="confirmSettlement(item)">确认结算金额</button><button v-if="item.status === 'executing'" @click="confirmWechat(item)">微信确认</button></div>
              </article>
              <p v-if="!payouts.length" class="empty">暂无提现记录</p>
            </div>
          </article>
          <form class="panel compact" @submit.prevent="bindRecipient">
            <div class="panel-title"><div><p>RECIPIENT</p><h2>收款信息</h2></div></div>
            <label>收款主体<select v-model="recipientForm.type"><option value="individual">自然人</option><option value="organization">企业</option></select></label>
            <label>结算渠道<select v-model="recipientForm.channel"><option v-if="recipientForm.type === 'individual'" value="wechat_transfer">微信商家转账</option><option value="manual_bank">人工结算</option></select></label>
            <label>收款人名称<input v-model="recipientForm.displayName" required maxlength="120"></label>
            <label v-if="recipientForm.channel === 'manual_bank'">收款账户信息<input v-model="recipientForm.accountReference" required autocomplete="off"></label>
            <p v-else class="hint">微信收款身份通过公众号 OAuth 绑定，系统不会把 OpenID 返回到页面。</p>
            <button :disabled="pending">{{ recipientForm.channel === 'wechat_transfer' ? '在微信中授权绑定' : '提交验证' }}</button>
            <small>收款信息加密保存。微信授权后直接完成身份验证；企业收款统一走人工结算。</small>
          </form>
        </section>

        <section v-else class="content-grid"><form class="panel" @submit.prevent="submitInquiry"><div class="panel-title"><div><p>INQUIRY</p><h2>提交佣金申诉</h2></div></div><div class="stack-form"><label>问题类型<select v-model="inquiryForm.type"><option value="missing_order">订单未计佣</option><option value="amount_dispute">佣金金额有疑问</option></select></label><label>订单编号<input v-model="inquiryForm.orderReference" required maxlength="80"></label><label>问题说明<textarea v-model="inquiryForm.description" required rows="7" minlength="10" maxlength="4000"></textarea></label><button :disabled="pending">提交申诉</button></div></form><aside class="panel compact"><h2>处理说明</h2><p class="hint">请填写可核对的订单编号和情况说明。大会运营人员会核对归因、订单明细、退款及结算记录；大额账务调整由两位管理员复核。</p></aside></section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.partner-account-page{min-height:100vh;background:#f3f6fa;color:#192338}.partner-account-shell{width:min(100% - 40px,1120px);margin:auto;padding:26px 0 72px}.back-link{display:inline-flex;margin-bottom:14px;color:#68758a;font-size:13px}.account-hero{display:flex;align-items:flex-end;justify-content:space-between;padding:32px 36px;border-radius:18px;background:linear-gradient(125deg,#102c50,#1e5de4);color:#fff;box-shadow:0 20px 44px rgb(21 55 110/16%)}.account-hero p,.panel-title p,.promotion-poster>p{margin:0;color:#b9d4ff;font:750 10px var(--conference-font-mono);letter-spacing:.12em}.account-hero h1{margin:8px 0 4px;font-size:clamp(28px,5vw,46px);letter-spacing:-.04em}.account-hero span{color:#dbe7ff}.hero-balance{text-align:right}.hero-balance small,.hero-balance em{display:block;color:#c9dcff;font-style:normal}.hero-balance strong{display:block;margin:5px 0;font-size:30px}.tab-nav{display:flex;gap:4px;margin:18px 0;padding:5px;overflow:auto;border:1px solid #dfe5ed;border-radius:12px;background:#fff}.tab-nav button{min-width:max-content;padding:11px 17px;border:0;border-radius:8px;background:transparent;color:#627086;font-weight:700}.tab-nav button.active{background:#eaf1ff;color:#1758d8}.rules-card,.panel{border:1px solid #dfe5ed;border-radius:14px;background:#fff;box-shadow:0 10px 30px rgb(25 43 71/5%)}.rules-card{display:flex;align-items:center;justify-content:space-between;gap:28px;margin-top:18px;padding:24px}.rules-card p{margin:0;color:#1e5de4;font-size:11px;font-weight:800;letter-spacing:.08em}.rules-card h2{margin:5px 0 8px}.rules-copy{max-height:110px;overflow:auto;color:#435168;line-height:1.7;white-space:pre-wrap}.rules-card small{display:block;margin-top:8px;color:#7b8798}.rules-card button,.panel button,.promotion-actions a,.promotion-actions .router-link-active{min-height:40px;padding:0 16px;border:1px solid #1e5de4;border-radius:8px;background:#1e5de4;color:#fff;font-weight:750}.content-grid,.promotion-layout{display:grid;grid-template-columns:minmax(0,1fr)330px;align-items:start;gap:16px}.panel{padding:24px}.panel.compact{display:grid;gap:16px}.panel-title{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.panel-title p{color:#1e5de4}.panel-title h2,.panel h2{margin:5px 0 0;font-size:21px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.form-grid .wide{grid-column:1/-1}label{display:grid;gap:7px;color:#5f6c80;font-size:12px;font-weight:700}input,textarea,select{width:100%;border:1px solid #d8e0ea;border-radius:8px;background:#fbfcfe;padding:11px 12px;color:#243149;font:inherit;box-sizing:border-box}textarea{resize:vertical}.avatar-editor{display:flex;align-items:center;gap:18px;margin-bottom:22px}.avatar{display:grid;width:90px;height:90px;place-items:center;overflow:hidden;border-radius:14px;background:#e8f0ff;color:#1e5de4;font-size:30px;font-weight:800}.avatar img{width:100%;height:100%;object-fit:cover}.avatar-editor label,.gallery-editor label{display:inline-flex;padding:9px 13px;border:1px solid #d5deeb;border-radius:8px;cursor:pointer}.avatar-editor input,.gallery-editor label input{display:none}.section-row{display:flex;align-items:center;justify-content:space-between;margin-top:22px}.gallery-list{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.gallery-list>div{padding:9px;border:1px solid #e2e7ef;border-radius:10px}.gallery-list img{width:100%;aspect-ratio:4/3;border-radius:6px;object-fit:cover}.gallery-list input{margin-top:7px}.gallery-list button{min-height:30px;margin-top:6px;border-color:#d7deea;background:#fff;color:#536177}.toggle-list{display:grid;grid-template-columns:repeat(2,1fr);gap:2px}.toggle-list label,.switch-line{display:flex;grid-template-columns:none;align-items:center;gap:8px;padding:9px 0}.toggle-list input,.switch-line input{width:auto}.panel>small{color:#7b8798;line-height:1.6}.promotion-poster{display:flex;min-height:510px;flex-direction:column;padding:26px;border-radius:16px;background:linear-gradient(150deg,#102c50,#1f5fe8 70%,#8bbaff);color:#fff;box-shadow:0 18px 40px rgb(20 52 104/18%)}.promotion-poster>div{margin-top:80px}.promotion-poster h2{margin:8px 0;font:700 40px Georgia,"Songti SC",serif}.promotion-poster span{color:#dce8ff}.promotion-poster footer{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-top:auto}.promotion-poster footer strong{max-width:150px;font-size:18px}.promotion-poster footer div{display:grid;gap:6px;text-align:center}.promotion-poster :deep(svg){padding:6px;background:#fff}.link-box{display:flex;gap:10px;margin:24px 0}.link-box code{flex:1;padding:13px;overflow:auto;border-radius:8px;background:#f2f5fa;color:#334159;white-space:nowrap}.promotion-actions{display:flex;flex-wrap:wrap;gap:8px}.promotion-actions a{display:inline-flex;align-items:center;border-color:#d5deeb;background:#fff;color:#3f4d63}.stack-form{display:grid;gap:14px}.data-list{display:grid;margin-top:24px}.data-list article{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid #e8edf3}.data-list article>div{display:grid;gap:4px}.data-list article>div:last-child{justify-items:end}.data-list small{color:#7b8798}.data-list em{color:#1e5de4;font-size:12px;font-style:normal}.data-list button{min-height:30px;margin-top:3px}.balance-pills{display:flex;gap:6px}.balance-pills span{padding:6px 9px;border-radius:999px;background:#edf3ff;color:#285ab8;font-size:11px}.hint{color:#5f6d81;line-height:1.8}.notice{margin:14px 0;padding:12px 16px;border-radius:9px}.notice.error{background:#fff0f0;color:#ad3030}.notice.success{background:#ecf8f0;color:#257344}.page-state,.empty{padding:80px 20px;text-align:center;color:#778397}.empty{padding:38px 0}@media(max-width:820px){.content-grid,.promotion-layout{grid-template-columns:1fr}.account-hero{align-items:flex-start}.promotion-poster{min-height:460px}}@media(max-width:560px){.partner-account-shell{width:min(100% - 24px,680px);padding-top:16px}.account-hero{display:grid;gap:22px;padding:24px}.hero-balance{text-align:left}.form-grid{grid-template-columns:1fr}.gallery-list{grid-template-columns:1fr}.rules-card{align-items:stretch;flex-direction:column}.panel{padding:19px}.panel-title{align-items:flex-start}.balance-pills{display:grid}.promotion-poster{min-height:420px}}
.document-links{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.document-links button{min-height:28px;margin:0;padding:3px 8px;border-color:#d7deea;background:#fff;color:#285ab8;font-size:11px}
</style>
