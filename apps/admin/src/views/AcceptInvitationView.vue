<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { conferenceApi } from '../lib/api';

const route = useRoute();
const pending = ref(false);
const accepted = ref(false);
const errorMessage = ref('');
const invitationParams = computed(() => new URLSearchParams(route.hash.replace(/^#/, '')));
const token = computed(
  () => invitationParams.value.get('token') ?? String(route.query.token ?? ''),
);
const organizationSlug = computed(
  () => invitationParams.value.get('organization') ?? String(route.query.organization ?? ''),
);
const form = reactive({
  name: '',
  password: '',
  confirmPassword: '',
});
const passwordMismatch = computed(() =>
  Boolean(form.confirmPassword && form.password !== form.confirmPassword),
);

async function accept() {
  errorMessage.value = '';
  if (!token.value) {
    errorMessage.value = '邀请链接缺少有效令牌，请联系管理员重新发送。';
    return;
  }
  if (form.password !== form.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致。';
    return;
  }
  pending.value = true;
  try {
    await conferenceApi.acceptInvitation({
      token: token.value,
      name: form.name.trim(),
      password: form.password,
    });
    accepted.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '邀请接受失败';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-story">
      <div class="login-brand">
        <span class="login-brand__mark">G</span><span>TokEMS 运营台</span>
      </div>
      <div class="login-story__copy">
        <small>ORGANIZATION INVITATION</small>
        <h1>一起把大会运营得清晰、有序。</h1>
        <p>接受邀请后，你会按照管理员分配的角色进入对应管理范围。</p>
      </div>
      <span class="login-story__foot">SECURE ORGANIZATION ACCESS</span>
    </section>
    <section class="login-form-wrap">
      <div v-if="accepted" class="login-form invitation-accepted">
        <p class="eyebrow">INVITATION ACCEPTED</p>
        <h2>已加入组织</h2>
        <p>成员账号已经创建，可以使用邮箱和刚设置的密码登录。</p>
        <RouterLink
          class="button"
          :to="{
            name: 'login',
            query: organizationSlug ? { organization: organizationSlug } : {},
          }"
        >
          前往登录
        </RouterLink>
      </div>
      <form v-else class="login-form" @submit.prevent="accept">
        <p class="eyebrow">ACCEPT INVITATION</p>
        <h2>接受组织邀请</h2>
        <p>填写姓名并设置密码。已有账号时，请输入现有账号密码。</p>
        <div class="login-fields">
          <label>姓名<input v-model="form.name" autocomplete="name" required /></label>
          <label>
            密码
            <input
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </label>
          <label>
            确认密码
            <input
              v-model="form.confirmPassword"
              type="password"
              autocomplete="new-password"
              minlength="8"
              :aria-invalid="passwordMismatch"
              :aria-describedby="passwordMismatch ? 'invitation-password-error' : undefined"
              required
            />
          </label>
          <p
            v-if="passwordMismatch"
            id="invitation-password-error"
            class="field-error"
            role="alert"
          >
            两次输入的密码不一致。
          </p>
        </div>
        <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
        <button class="button" type="submit" :disabled="pending || passwordMismatch">
          {{ pending ? '正在加入…' : '接受邀请' }}
        </button>
      </form>
    </section>
  </main>
</template>
