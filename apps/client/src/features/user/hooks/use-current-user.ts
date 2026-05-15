import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getMyInfo } from "@/features/user/services/user-service";
import { ICurrentUser } from "@/features/user/types/user.types";

export const CURRENT_USER_QUERY_KEY = ["currentUser"] as const;

export default function useCurrentUser(): UseQueryResult<ICurrentUser> {
  return useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: async () => {
      return await getMyInfo();
    },
  });
}
