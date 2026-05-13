import { useSearchParams } from 'react-router-dom';
import { Result } from 'antd';

const REASON_TEXT: Record<string, string> = {
  TOKEN_MISSING: '缺少 SSO Token，请通过统一入口进入。',
  TOKEN_CONSUMED: 'SSO Token 已被使用或失效，请重新发起登录。',
  SSO_TIMEOUT: 'SSO 校验超时，请稍后再试。',
  SSO_UNREACHABLE: 'SSO 服务暂不可用。',
  SSO_BAD_RESPONSE: 'SSO 返回数据异常。',
  SSO_NO_USER_ID: '无法获取用户身份。',
  SSO_REJECTED: 'SSO 校验未通过。',
  UNTRUSTED_ORIGIN: '请通过 SSO 统一入口进入系统。',
  unauthorized: '登录已过期，请重新发起 SSO 登录。',
};

export function SsoFailedPage() {
  const [params] = useSearchParams();
  const reason = params.get('reason') || 'unauthorized';
  const subTitle = REASON_TEXT[reason] || `SSO 校验未通过：${reason}`;
  return (
    <Result
      status="403"
      title="无法进入系统"
      subTitle={subTitle}
    />
  );
}
