export const ZilliqaGuardedTokenPayout = `
scilla_version 0
import ListUtils IntUtils PairUtils
library GuardedTokenPayout

type Error =
| AdminValidationFailed
| StagingAdminNotExist
| StagingAdminValidationFailed
| WrongTokenImplementationAddress
| ThisIsNotTokenRecipient
| NoMoreBlockLimitsImposed
| BlockNumberNotYetAtTarget
| ThereAreStillScheduledPayouts

let make_error =
fun (result: Error) =>
let result_code =
match result with
| AdminValidationFailed => Int32 -1
| StagingAdminNotExist => Int32 -2
| StagingAdminValidationFailed => Int32 -3
| WrongTokenImplementationAddress => Int32 -4
| ThisIsNotTokenRecipient => Int32 -5
| NoMoreBlockLimitsImposed => Int32 -6
| BlockNumberNotYetAtTarget => Int32 -7
| ThereAreStillScheduledPayouts => Int32 -8
end
in
{ _exception: "Error"; code: result_code }

let zero = Uint128 0

let transfer_tag = "Transfer"

let one_msg =
fun (m : Message) =>
let e = Nil {Message} in
Cons {Message} m e

let bnum_list_head = @list_head BNum

let bnum_list_tail = @list_tail BNum

let nil_bnum_list = Nil {BNum}

contract GuardedTokenPayout(
    init_admin: ByStr20,
    init_token_impl: ByStr20,
    fixed_payout_amount: Uint128,
    init_payout_schedule: List BNum
)
(* Current contract admin *)
field contractadmin: ByStr20  = init_admin
(* Current token implementation *)
field token_impl: ByStr20  = init_token_impl
(* Admin that can be claimed by existing address *)
field stagingcontractadmin: Option ByStr20 = None {ByStr20}
(* payout schedule to withdraw tokens over *)
field payout_schedule: List BNum = init_payout_schedule

procedure ThrowError(err: Error)
    e = make_error err;
    throw e
end
procedure IsAdmin(initiator: ByStr20)
    contractadmin_tmp <- contractadmin;
    is_admin = builtin eq initiator contractadmin_tmp;
    match is_admin with
    | True  =>
    | False =>
        e = AdminValidationFailed;
        ThrowError e
    end
end
procedure ThisIsRecipient(recipient: ByStr20)
    is_recipient = builtin eq recipient _this_address;
    match is_recipient with
    | True  =>
    | False =>
        e = ThisIsNotTokenRecipient;
        ThrowError e
    end
end
procedure IsRightImplementation()
    impl <- token_impl;
    is_right_implementation = builtin eq _sender impl;
    match is_right_implementation with
    | True  =>
    | False =>
        e = WrongTokenImplementationAddress;
        ThrowError e
    end
end
procedure TransferToken(tag: String, amt: Uint128, recipient: ByStr20)
    impl <- token_impl;
    msg = {_tag: tag; _recipient: impl; _amount: zero; to: recipient; amount: amt};
    msgs = one_msg msg;
    send msgs
end
procedure CurrentBlockNumberBiggerThan(other: BNum)
    cur_blk <- & BLOCKNUMBER;
    is_after = builtin blt other cur_blk;
    match is_after with
    | True  =>
    | False =>
        e = BlockNumberNotYetAtTarget;
        ThrowError e
    end
end
procedure IsAfterAllScheduledPayouts()
    schedule <- payout_schedule;
    there_are_payouts = bnum_list_head schedule;
    match there_are_payouts with
    | Some payouts =>
        e = ThereAreStillScheduledPayouts;
        ThrowError e
    | None => 
    end
end
(* Update staged admin *)
transition UpdateAdmin(admin: ByStr20)
    IsAdmin _sender;
    staging_admin = Some {ByStr20} admin;
    stagingcontractadmin := staging_admin
end
(* Update token implementation *)
transition UpdateTokenImplementation(new_impl: ByStr20)
    IsAdmin _sender;
    token_impl := new_impl
end
(* Staged admin can claim the staged admin and become admin *)
transition ClaimAdmin()
    staging_admin <- stagingcontractadmin;
    match staging_admin with
    | Some admin =>
        is_valid = builtin eq _sender admin;
        match is_valid with
        | True =>
            contractadmin := admin;
            staging_admin = None {ByStr20};
            stagingcontractadmin := staging_admin;
            e = { _eventname: "ClaimAdmin"; new_admin: admin };
            event e
        | False =>
            e = StagingAdminValidationFailed;
            ThrowError e
        end
    | None =>
        e = StagingAdminNotExist;
        ThrowError e
    end
end
(* get back remaining zrc2 tokens*)
(* only after all of the milestones were finished *)
transition DrainContractBalance(amt: Uint128)
    IsAdmin _sender;
    IsAfterAllScheduledPayouts;
    bal <- _balance;
    cur_impl <- token_impl;
    msg = {_tag: transfer_tag; _recipient: cur_impl; _amount: zero; to: _sender; amount: amt};
    msgs = one_msg msg;
    send msgs;
    e = { _eventname: "DrainContractBalance"; to: _sender; amount: amt};
    event e
end
(* to be able to send the tokens back to admin *)
transition TransferSuccessCallBack(sender: ByStr20, recipient: ByStr20, amount: Uint128)
end
(* accepts tokens from implementation *)
transition RecipientAcceptTransfer(sender: ByStr20, recipient: ByStr20, amount: Uint128)
    IsRightImplementation;
    ThisIsRecipient recipient
end
(* withdraw if head of the limits list is smaller than blocknumber *)
transition Withdraw()
    IsAdmin _sender;
    schedule <- payout_schedule;
    maybe_head = bnum_list_head schedule;
    match maybe_head with
    | Some blockLimit =>
        (* there are scheduled payouts *)
        CurrentBlockNumberBiggerThan blockLimit;
        (* by that point eligible for withdrawal *)
        contractadmin_tmp <- contractadmin;
        (* send fixed token amt to admin *)
        TransferToken transfer_tag fixed_payout_amount contractadmin_tmp;
        e = { _eventname: "Withdraw"; to: contractadmin_tmp; amount: fixed_payout_amount};
        event e;
        (* set the payout_schedule to have the remaining part of the list *)
        maybe_tail = bnum_list_tail schedule;
        match maybe_tail with
        | Some remaining_schedules =>
            payout_schedule := remaining_schedules
        | None => 
            payout_schedule := nil_bnum_list
        end
    | None => 
        e = NoMoreBlockLimitsImposed;
        ThrowError e
    end
end
`;
