Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    items: [
        {xtype:'container',itemId:'message_box',tpl:'Hello, <tpl>{_refObjectName}</tpl>'},
        {xtype:'container',itemId:'display_box', margin: 10},
        {xtype:'tsinfolink'}
    ],
    launch: function() {
        
        this._loadStories().then({
            scope: this,
            success: function(store){
                this.down('#display_box').add({
                    xtype: 'rallygrid',
                    store: store,
                    columnCfgs: [
                        {dataIndex:'FormattedID',text:'id'}, 
                        {dataIndex:'Name',text:'Name'},
                        {dataIndex: 'PlanEstimate', text:'Plan Estimate (Pts)'},
                        {dataIndex: 'TaskEstimateTotal', text:'Estimate Hours'},
                        {dataIndex: 'TaskActualTotal', text:'Actual Hours'},
                        {dataIndex: 'TaskRemainingTotal', text:'To Do'}
                    ]
                });
            },
            failure: function(error_message){
                alert(error_message);
            }
        });
    },
    _loadStories: function(){
        var deferred = Ext.create('Deft.Deferred');
        
        var project_oid = this.getContext().getProject().ObjectID;
        
        var store = Ext.create('Rally.data.lookback.SnapshotStore', {
            fetch: ['Name','ObjectID','FormattedID','TaskActualTotal','TaskEstimateTotal','PlanEstimate','TaskRemainingTotal'],
            filters: [{
                property: '_TypeHierarchy',
                value: 'HierarchicalRequirement'
            },{
                property: '__At',
                value: 'current'
            },{
                property: '_ProjectHierarchy',
                value: project_oid
            }],
            autoLoad: true,
            listeners: {
                load: function(store, records, successful) {
                    if (successful){
                        deferred.resolve(store);
                    } else {
                        deferred.reject('Failed to load initial Snapshot Store');
                    }
                }
            }
        });
        return deferred.promise;
    }
});