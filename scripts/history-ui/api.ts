// All data is synthetic and served by the test runner, never the deployment.
export default {
  post: async (path: string, body: unknown) => ({
    data: await (
      await fetch("/api" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json(),
  }),
};
