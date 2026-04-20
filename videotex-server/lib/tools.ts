const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const fetchJSON = async (url: string, options?: RequestInit) => {
  try {
    const r = await fetch(url, {
      ...options,
      headers: {
        "User-Agent": USER_AGENT,
        ...options?.headers,
      },
    });
    if (r.ok) {
      return await r.json();
    }
  } catch (e) {
    console.log(e);
  }
  return null;
};
