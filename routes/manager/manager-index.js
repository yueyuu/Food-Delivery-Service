const express = require("express");
const router = express.Router();
const db = require("../../database/db");

const sidebarItems = [
    {name: "Dashboard", link: "/", icon: "tachometer-alt"},
    {name: "Users", link: "/manager/users", icon: "users"},
    {name: "Promotions", link: "/manager/promotions", icon: "percentage"},
];

router.all("*", function (req, res, next) {
    if (!req.user || req.user.role !== "manager") {
        return res.redirect("/");
    } else {
        next();
    }
});

router.get("/", async function (req, res) {
    let stats, cus_stats;
    try {
        stats = await db.any(
            "with recursive MonthlyCalendar as (\n" +
            "    select CURRENT_TIMESTAMP as date\n" +
            "    union all\n" +
            "    select date - interval '1 month'\n" +
            "    from MonthlyCalendar\n" +
            "    where date > CURRENT_TIMESTAMP - interval '11 month'\n" +
            ")\n" +
            "select to_char(mc.date, 'YYYY-MM') as yearmonth,\n" +
            "       count(distinct c.id) as total_new_users,\n" +
            "       coalesce(sum(o.food_cost::numeric + o.delivery_cost::numeric), 0::numeric) as total_order_revenue,\n" +
            "       count(distinct o.id) as total_order_num\n" +
            "from MonthlyCalendar mc\n" +
            "    left join (Customers natural join Users) c\n" +
            "    on to_char(c.join_date, 'YYYY-MM') = to_char(mc.date, 'YYYY-MM')\n" +
            "    left join Orders o\n" +
            "    on to_char(o.time_placed, 'YYYY-MM') = to_char(mc.date, 'YYYY-MM')\n" +
            "group by to_char(mc.date, 'YYYY-MM')\n" +
            "order by yearmonth desc;\n"
        );
        cus_stats = await db.any(
            "select c.id, count(distinct o.id) as total_order_num, sum(o.food_cost + o.delivery_cost) as total_spending\n" +
            "from Customers c join Orders o on c.id = o.cid  and to_char(o.time_placed, 'YYYY-MM') = to_char(CURRENT_TIMESTAMP, 'YYYY-MM')\n" +
            "group by c.id\n"
        );
    } catch (e) {
        console.log(e);
    }
    console.log(stats);
    res.render("pages/manager/manager-index", {
        sidebarItems: sidebarItems,
        user: req.user, navbarTitle: "Welcome",
        stats: stats,
        cus_stats: cus_stats
    });
});

router.get("/users", async function (req, res) {
    let users;
    try {
        users = await db.any("select * from UserInfo");
    } catch (e) {
        console.log(e);
    }
    res.render("pages/manager/manager-users", {
        sidebarItems: sidebarItems,
        user: req.user, navbarTitle: "Users",
        users: users
    });
});

router.get("/users/remove/:id", async function (req, res) {
    let users;
    try {
        await db.none("DELETE FROM Users WHERE id = $1", [req.params.id]);
    } catch (e) {
        req.flash("error", "Deletion failed.");
    } finally {
        res.redirect("/manager/users");
    }
});

router.get("/users/riderInfo/:rid", async function (req, res) {
    let records = [];
    let rider_type = await db.one("select type from Riders where id = $1", req.params.rid);
    rider_type = rider_type.type;

    await db.each("select * from RiderSummary where rid = $1 order by start_date desc", req.params.rid, row => {
        let duration = [row.start_date.getFullYear(), row.start_date.getMonth() + 1, row.start_date.getDate()].join('/');
        if (rider_type === 'full_time') {
            row.start_date.setDate(row.start_date.getDate() + 27);
        } else {
            row.start_date.setDate(row.start_date.getDate() + 6);
        }
        duration += " - ";
        duration += [row.start_date.getFullYear(), row.start_date.getMonth() + 1, row.start_date.getDate()].join('/');
        let record = {duration: duration, num_order: row.num_order, total_hour: row.total_hour,
            base_salary: row.base_salary, bonus_salary: row.bonus_salary, total_salary: row.total_salary,
            avg_delivery_time: row.avg_delivery_time, num_rating: row.num_rating, avg_rating: row.avg_rating};
        records.push(record);
    });

    let rider_type_display;
    if (rider_type === 'part_time') {
        rider_type_display = 'Part Time Rider';
    } else if (rider_type === 'full_time') {
        rider_type_display = 'Full Time Rider';
    }

    console.log(records);

    res.render("pages/manager/manager-riderInfo", {
        sidebarItems: sidebarItems,
        user: req.user,
        navbarTitle: "Summary of " + rider_type_display + " " + req.params.rid,
        records: records,

        successFlash: req.flash("success"),
        errorFlash: req.flash("error")
    });
});


router.post("/users/add", async function (req, res) {
    let users;
    try {
        await db.any("begin; INSERT INTO Users (id, password, username) VALUES ($1, $2, $3); INSERT INTO Managers (id) VALUES ($1); end;",
            [req.body.id, req.body.password, req.body.name, req.body.id]);
    } catch (e) {
        console.log("failed");
        //req.flash("error", "Deletion failed.");
    } finally {
        res.redirect("/manager/users");
    }
    // db.tx(t => {
    //     const a = db.any("INSERT INTO Users (id, password, username) VALUES ($1, $2, $3);",
    //         [req.body.id, req.body.password, req.body.name]);
    //     const b = db.any("INSERT INTO Managers (id) VALUES ($1)", [req.body.id]);
    //     return t.batch([a, b]);
    // }).catch(e => {
    //     req.flash("error", "Deletion failed.");
    // }).finally(() => {
    //     res.redirect("/manager/users");
    // });
});

router.get("/promotions", async function (req, res) {
    let actions, rules, promotions;
    try {
        rules = await db.any("select *, case when exists(select 1 from Managers where Managers.id = PromotionRules.giver_id) then true else false end as is_admin from PromotionRules where giver_id = $1 or exists(select 1 from Managers where Managers.id = giver_id)", req.user.id);
        actions = await db.any("select *, case when exists(select 1 from Managers where Managers.id = PromotionActions.giver_id) then true else false end as is_admin from PromotionActions where giver_id = $1 or exists(select 1 from Managers where Managers.id = giver_id)", req.user.id);
        promotions = await db.any("select *, case when exists(select 1 from Managers where Managers.id = Promotions.giver_id) then true else false end as is_admin from Promotions where giver_id = $1 or exists(select 1 from Managers where Managers.id = giver_id)", req.user.id);
    } catch (e) {
        console.log(e);
    }
    res.render("pages/manager/manager-promotions", {
        sidebarItems: sidebarItems,
        user: req.user,
        navbarTitle: "Promotions",

        rules: rules,
        actions: actions,
        promotions: promotions,
        rtypes: ["ORDER_TOTAL", "NTH_ORDER"],
        atypes: ["FOOD_DISCOUNT", "DELIVERY_DISCOUNT"], //TODO: Avoid hardcode values

        successFlash: req.flash("success"),
        errorFlash: req.flash("error")
    });
});

router.post("/promotions/addrule", async function (req, res) {
    try {
        await db.none("insert into PromotionRules (giver_id, rtype, config) values ($1, $2, $3)",
            [req.user.id, req.body.rtype, req.body.config]);
        req.flash("success", "Rule added.");
    } catch (e) {
        console.log(e);
        req.flash("error", "Error when adding rule.");
    } finally {
        res.redirect("/manager/promotions");
    }
});

router.post("/promotions/addaction", async function (req, res) {
    try {
        await db.none("insert into PromotionActions (giver_id, atype, config) values ($1, $2, $3)",
            [req.user.id, req.body.rtype, req.body.config]);
        req.flash("success", "Action added.");
    } catch (e) {
        console.log(e);
        req.flash("error", "Error when adding action.");
    } finally {
        res.redirect("/manager/promotions");
    }
});

router.post("/promotions/addpromo", async function (req, res) {
    try {
        await db.none("insert into Promotions (promo_name, rule_id, action_id, start_time, end_time, giver_id) " +
            "values ($1, $2, $3, $4, $5, $6)",
            [req.body.desc, req.body.rule, req.body.action, req.body.start, req.body.end, req.user.id]);
        req.flash("success", "Promotion added.");
    } catch (e) {
        console.log(e);
        req.flash("error", "Error when adding promotion.");
    } finally {
        res.redirect("/manager/promotions");
    }
});

router.get("/promotions/remove", async function (req, res) {
    try {
        if (req.query.actionid) {
            await db.none("delete from PromotionActions where id = $1", req.query.actionid);
        } else if (req.query.ruleid) {
            await db.none("delete from PromotionRules where id = $1", req.query.ruleid);
        } else if (req.query.promoid) {
            await db.none("delete from Promotions where id = $1", req.query.promoid);
        }
    } catch (e) {
        console.log(e);
        req.flash("error", "Error when removing.");
    } finally {
        res.redirect("/manager/promotions");
    }
});

router.get("/settings", async function (req, res) {
    res.render("pages/manager/manager-settings", {
        sidebarItems: sidebarItems,
        user: req.user,
        navbarTitle: "Settings",

        successFlash: req.flash("success"),
        errorFlash: req.flash("error")
    });
});

router.post("/settings", async function (req, res) {
    try {
        if (req.body.password === "") {
            await db.any("begin; " +
                "update Users set username = $/userName/ where id = $/userId/; " +
                "commit;",
                {...req.body, userId: req.user.id});
        } else {
            await db.any("begin; " +
                "update Users set username = $/userName/, password = $/password/ where id = $/userId/; " +
                "commit;",
                {...req.body, userId: req.user.id});
        }
        req.flash("success", "Update success.");
        res.redirect("/logout");
    } catch (e) {
        console.log(e);
        req.flash("error", "Update failed.");
        res.redirect("/manager/settings");
    }
});


module.exports = router;
