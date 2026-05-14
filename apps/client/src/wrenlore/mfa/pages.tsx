import { Navigate } from "react-router-dom";

export function MfaChallengePage() {
  return <Navigate to="/login" replace />;
}

export function MfaSetupRequiredPage() {
  return <Navigate to="/home" replace />;
}
