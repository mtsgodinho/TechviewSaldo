export function taxCents(spend:number){if(!Number.isSafeInteger(spend)||spend<0)throw new Error('Gasto inválido');const result=Number((BigInt(spend)*12n+50n)/100n);if(!Number.isSafeInteger(result+spend))throw new Error('Valor fora do limite');return result;}
export function campaignBill(c:{observed_cents:number;baseline_cents:number;charged_cents:number}){const spend=Math.max(0,c.observed_cents-c.baseline_cents),tax=taxCents(spend),total=spend+tax;return {spend,tax,total,pending:Math.max(0,total-c.charged_cents)};}
// Crédito não consumido menos dívida ainda não lançada. Não limita a zero:
// ao liquidar uma pendência, crédito e pendência diminuem igualmente.
export function netWalletBalance(credit:number,campaigns:Parameters<typeof campaignBill>[0][]){return credit-campaigns.reduce((sum,c)=>sum+campaignBill(c).pending,0);}
