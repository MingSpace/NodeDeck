import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface MeResponse {
  authenticated: boolean;
  username?: string;
  must_change_password?: boolean;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const meQuery = useQuery<MeResponse>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>("/api/auth/me");
      } catch {
        return { authenticated: false };
      }
    },
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (payload: { username: string; password: string }) =>
      api.post<MeResponse>("/api/auth/login", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post("/api/auth/logout", {}),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], { authenticated: false });
      void navigate("/login");
    },
  });

  return {
    isChecking: meQuery.isLoading,
    isAuthed: meQuery.data?.authenticated ?? false,
    mustChangePassword: meQuery.data?.must_change_password ?? false,
    username: meQuery.data?.username,
    login: loginMutation.mutateAsync,
    loginPending: loginMutation.isPending,
    logout: () => logoutMutation.mutate(),
  };
}
