export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // FormData 走 multipart：必须让浏览器自己设带 boundary 的 Content-Type，
  // 我们一手塞 application/json 反而会把上传请求拍碎。
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  if (response.status === 401) {
    window.location.replace('/sso/failed?reason=unauthorized');
    throw new ApiError('未登录或登录已过期', 401);
  }
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload.detail === 'string') {
      return payload.detail;
    }
    return JSON.stringify(payload.detail ?? payload);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function downloadUrl(path: string): string {
  return path.startsWith('http') ? path : path;
}
