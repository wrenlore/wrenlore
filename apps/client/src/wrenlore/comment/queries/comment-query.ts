import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/main";
import api from "@/lib/api-client";

export function useResolveCommentMutation() {
  return useMutation({
    mutationFn: async (data: { commentId: string; pageId: string; resolved: boolean }) => {
      const req = await api.post("/comments/resolve", data);
      return req.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["comments", variables.pageId] });
    },
  });
}
