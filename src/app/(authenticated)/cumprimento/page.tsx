import { redirect } from "next/navigation";

export default function CumprimentoPage() {
  redirect("/fila?stage=CUMPRIMENTO&status=EM+ANDAMENTO");
}
