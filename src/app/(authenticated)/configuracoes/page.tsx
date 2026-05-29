import { UserManagementPanel } from "@/components/user-management-panel";
import { canManageUsers, getCurrentProfile, getManagedUsers } from "@/lib/data";

export default async function ConfiguracoesPage() {
  const profile = await getCurrentProfile();
  const canManage = canManageUsers(profile);
  const users = canManage ? await getManagedUsers() : [];

  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-xl font-semibold">Configuracoes</h1>
      </div>
      <div className="p-5">
        <UserManagementPanel canManageUsers={canManage} profile={profile} users={users} />
      </div>
    </>
  );
}
