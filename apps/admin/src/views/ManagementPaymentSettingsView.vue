<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { WeChatPayConfiguration } from '@conference/contracts';
import SettingsFormActions from '../components/SettingsFormActions.vue';
import { useSettingsFormScope } from '../composables/settings-form-state';
import { conferenceApi, session } from '../lib/api';

const configuration = ref<WeChatPayConfiguration>();
const loading = ref(true);
const loaded = ref(false);
const pending = ref(false);
const testing = ref(false);
const showMerchantPrivateKey = ref(false);
const message = ref('');
const errorMessage = ref('');
const form = reactive({
  enabled: true,
  appId: '',
  mchId: '',
  merchantCertificateSerial: '',
  merchantPrivateKey: '',
  apiV3Key: '',
  platformPublicKeyId: '',
  platformPublicKey: '',
});
const canManage = computed(() => session.canAny(['org.settings.manage']));
const { clearDirty, dirty, setBusy, setResetHandler } = useSettingsFormScope();
const statusLabel = computed(() => {
  const labels = {
    unconfigured: '待配置',
    configured: '待验证',
    verified: '验证通过',
    error: '验证失败',
  };
  return labels[configuration.value?.status ?? 'unconfigured'];
});

function applyConfiguration(value: WeChatPayConfiguration) {
  configuration.value = value;
  Object.assign(form, {
    enabled: value.enabled,
    appId: value.appId,
    mchId: value.mchId,
    merchantCertificateSerial: value.merchantCertificateSerial,
    merchantPrivateKey: '',
    apiV3Key: '',
    platformPublicKeyId: value.platformPublicKeyId,
    platformPublicKey: '',
  });
  showMerchantPrivateKey.value = false;
  clearDirty();
}

function resetForm() {
  if (configuration.value) applyConfiguration(configuration.value);
}

setResetHandler(resetForm);
watch([pending, testing], () => setBusy(pending.value || testing.value), { immediate: true });

async function load() {
  loading.value = true;
  loaded.value = false;
  errorMessage.value = '';
  try {
    applyConfiguration(await conferenceApi.getWeChatPayConfiguration());
    loaded.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '微信支付配置读取失败';
  } finally {
    loading.value = false;
  }
}

async function testConnection() {
  if (!loaded.value) {
    errorMessage.value = '请先重新载入微信支付配置';
    return;
  }
  testing.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    const result = await conferenceApi.testWeChatPayConfiguration();
    configuration.value = await conferenceApi.getWeChatPayConfiguration();
    if (result.ok) {
      message.value = result.message;
    } else {
      errorMessage.value = result.message;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '微信支付连接验证失败';
  } finally {
    testing.value = false;
  }
}

async function save() {
  if (!loaded.value) {
    errorMessage.value = '请先重新载入微信支付配置';
    return;
  }
  pending.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    const result = await conferenceApi.updateWeChatPayConfiguration({
      enabled: form.enabled,
      appId: form.appId.trim(),
      mchId: form.mchId.trim(),
      merchantCertificateSerial: form.merchantCertificateSerial.trim(),
      platformPublicKeyId: form.platformPublicKeyId.trim(),
      ...(form.merchantPrivateKey.trim()
        ? { merchantPrivateKey: form.merchantPrivateKey.trim() }
        : {}),
      ...(form.apiV3Key ? { apiV3Key: form.apiV3Key } : {}),
      ...(form.platformPublicKey.trim()
        ? { platformPublicKey: form.platformPublicKey.trim() }
        : {}),
    });
    applyConfiguration(result);
    message.value = '配置已加密保存，正在验证微信支付连接。';
    await testConnection();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '微信支付配置保存失败';
  } finally {
    pending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <p v-if="message" class="admin-success" role="status">{{ message }}</p>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <div v-if="loading" class="admin-loading">正在载入支付设置…</div>
  <div v-else-if="!loaded" class="admin-loading">
    <button class="btn btn-secondary" type="button" @click="load">重新载入</button>
  </div>

  <section v-else class="admin-panel settings-module">
    <header class="admin-panel-header settings-module-header">
      <div>
        <p class="settings-module-kicker">WECHAT PAY · NATIVE</p>
        <h1>支付服务</h1>
        <p>为全部大会启用微信扫码支付，订单回调会自动完成出票。</p>
      </div>
      <div class="settings-module-status">
        <span class="status-badge" :class="configuration?.status === 'verified' ? 'paid' : 'draft'">
          {{ statusLabel }}
        </span>
        <button
          v-if="canManage"
          class="button secondary compact"
          type="button"
          :disabled="testing || pending || dirty || configuration?.status === 'unconfigured'"
          :title="dirty ? '请先保存当前修改再重新验证' : undefined"
          @click="testConnection"
        >
          {{ testing ? '验证中…' : '重新验证' }}
        </button>
      </div>
    </header>
    <form
      class="event-form settings-form-spaced"
      data-settings-form
      :inert="pending || testing"
      :aria-busy="pending || testing"
      @submit.prevent="save"
    >
      <div class="settings-summary">
        <div>
          <span>支付方式</span>
          <strong>Native 扫码支付</strong>
        </div>
        <div>
          <span>回调地址</span>
          <code>{{ configuration?.notifyUrl }}</code>
        </div>
        <label class="settings-toggle">
          <input v-model="form.enabled" type="checkbox" :disabled="!canManage" />
          <span>{{ form.enabled ? '已启用' : '已停用' }}</span>
        </label>
      </div>
      <section class="settings-form-section" aria-labelledby="payment-identity-heading">
        <div class="settings-form-section-head">
          <div>
            <h2 id="payment-identity-heading">商户身份</h2>
            <p>填写微信开放平台与商户平台中对应的账号和证书标识。</p>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label for="wechat-app-id">AppID</label>
            <input
              id="wechat-app-id"
              v-model="form.appId"
              required
              maxlength="64"
              :disabled="!canManage"
            />
          </div>
          <div class="form-field">
            <label for="wechat-mch-id">商户号 MCHID</label>
            <input
              id="wechat-mch-id"
              v-model="form.mchId"
              required
              inputmode="numeric"
              maxlength="32"
              :disabled="!canManage"
            />
          </div>
          <div class="form-field">
            <label for="wechat-cert-serial">商户证书序列号</label>
            <input
              id="wechat-cert-serial"
              v-model="form.merchantCertificateSerial"
              required
              maxlength="128"
              :disabled="!canManage"
            />
          </div>
          <div class="form-field">
            <label for="wechat-public-key-id">微信支付公钥 ID</label>
            <input
              id="wechat-public-key-id"
              v-model="form.platformPublicKeyId"
              required
              maxlength="128"
              :disabled="!canManage"
            />
          </div>
        </div>
      </section>

      <section class="settings-form-section" aria-labelledby="payment-credentials-heading">
        <div class="settings-form-section-head">
          <div>
            <h2 id="payment-credentials-heading">加密凭据</h2>
            <p>已保存的敏感内容不会回传浏览器，留空即可继续使用原值。</p>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-field full">
            <div class="settings-secret-label">
              <label for="wechat-private-key">商户 API 私钥</label>
              <button
                class="text-link"
                type="button"
                :disabled="!form.merchantPrivateKey"
                :aria-pressed="showMerchantPrivateKey"
                @click="showMerchantPrivateKey = !showMerchantPrivateKey"
              >
                {{ showMerchantPrivateKey ? '隐藏内容' : '显示内容' }}
              </button>
            </div>
            <textarea
              id="wechat-private-key"
              v-model="form.merchantPrivateKey"
              class="settings-secret-input"
              :class="{ 'is-masked': !showMerchantPrivateKey }"
              rows="5"
              autocomplete="new-password"
              :required="!configuration?.secretsPresent.merchantPrivateKey"
              :placeholder="
                configuration?.secretsPresent.merchantPrivateKey
                  ? '已安全保存，留空保持原值'
                  : '粘贴 PEM 格式商户私钥'
              "
              :disabled="!canManage"
            />
          </div>
          <div class="form-field full">
            <label for="wechat-api-v3-key">APIv3 密钥</label>
            <input
              id="wechat-api-v3-key"
              v-model="form.apiV3Key"
              type="password"
              autocomplete="new-password"
              minlength="32"
              maxlength="32"
              :required="!configuration?.secretsPresent.apiV3Key"
              :placeholder="
                configuration?.secretsPresent.apiV3Key
                  ? '已安全保存，留空保持原值'
                  : '32 位 APIv3 密钥'
              "
              :disabled="!canManage"
            />
          </div>
          <div class="form-field full">
            <label for="wechat-public-key">微信支付公钥</label>
            <textarea
              id="wechat-public-key"
              v-model="form.platformPublicKey"
              rows="5"
              autocomplete="off"
              :required="!configuration?.secretsPresent.platformPublicKey"
              :placeholder="
                configuration?.secretsPresent.platformPublicKey
                  ? '已安全保存，留空保持原值'
                  : '-----BEGIN PUBLIC KEY-----'
              "
              :disabled="!canManage"
            />
          </div>
        </div>
      </section>
      <div class="settings-security-note">
        <strong>安全策略</strong>
        <span>三项密钥会使用 AES-256-GCM
          加密保存，浏览器只会看到“已保存”状态。每次修改都会留下审计记录。</span>
      </div>
      <div v-if="configuration?.lastError" class="settings-inline-error">
        最近一次验证：{{ configuration.lastError }}
      </div>
      <SettingsFormActions
        v-if="canManage"
        :pending="pending"
        :disabled="testing"
        primary-label="保存并验证"
      />
    </form>
  </section>
</template>
